import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';

dotenv.config();

const app: Express = express();
const prisma = new PrismaClient();

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(helmet());
app.use(cors());
app.use(express.json());

// Accept both /users/... and /api/users/... when callers include a base prefix.
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.url === '/api') {
    req.url = '/';
  } else if (req.url.startsWith('/api/')) {
    req.url = req.url.slice(4);
  }
  next();
});

// Initialize Firebase Admin SDK
const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
let auth: ReturnType<typeof getAuth> | null = null;

if (firebaseServiceAccountPath && fs.existsSync(firebaseServiceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(firebaseServiceAccountPath, 'utf-8'));
  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  auth = getAuth();
} else if (isProduction) {
  console.error('❌ Firebase service account JSON not found at:', firebaseServiceAccountPath);
  process.exit(1);
} else {
  console.warn('⚠️ Firebase Admin is disabled because FIREBASE_SERVICE_ACCOUNT_PATH is missing.');
}
const allowedDomain = process.env.COMPANY_EMAIL_DOMAIN || 'letstransport.team';

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const isMissingColumnError = (error: unknown, columnName: string) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2022') {
    return false;
  }

  const metaColumn = String((error.meta as { column?: unknown } | undefined)?.column || '').toLowerCase();
  if (metaColumn && metaColumn.includes(columnName.toLowerCase())) {
    return true;
  }

  const message = String(error.message || '').toLowerCase();
  return message.includes(columnName.toLowerCase());
};

async function findUserByEmailLoose(email: string) {
  const rawEmail = String(email || '').trim();
  const normalizedEmail = normalizeEmail(rawEmail);

  if (!rawEmail && !normalizedEmail) {
    return null;
  }

  if (normalizedEmail) {
    try {
      const byNormalized = await prisma.user.findUnique({
        where: { emailNormalized: normalizedEmail },
      });
      if (byNormalized) {
        return byNormalized;
      }
    } catch (error) {
      // Keep compatibility with partially-migrated schemas that do not yet include emailNormalized.
      if (!isMissingColumnError(error, 'emailNormalized')) {
        throw error;
      }
    }
  }

  if (!rawEmail) {
    return null;
  }

  const byEmail = await prisma.user.findFirst({
    where: {
      email: {
        equals: rawEmail,
      },
    },
  });
  if (byEmail) {
    return byEmail;
  }

  const candidates = await prisma.user.findMany({
    where: {
      OR: [{ email: rawEmail.toLowerCase() }, { email: rawEmail.toUpperCase() }],
    },
    take: 5,
  });

  return candidates.find((row) => normalizeEmail(row.email) === normalizedEmail) || null;
}

async function remapUserOwnership(
  client: Pick<PrismaClient, 'request' | 'requestHistory'>,
  sourceUserId: string,
  targetUserId: string,
  email: string,
  emailNormalized: string,
  actorName: string | null,
) {
  await client.request.updateMany({
    where: { createdBy: sourceUserId },
    data: {
      createdBy: targetUserId,
      createdByEmail: email,
    },
  });

  await client.request.updateMany({
    where: { assignedRhUserId: sourceUserId },
    data: {
      assignedRhUserId: targetUserId,
      assignedRhEmail: email,
      assignedRhEmailNormalized: emailNormalized,
    },
  });

  await client.request.updateMany({
    where: { assignedFoId: sourceUserId },
    data: {
      assignedFoId: targetUserId,
      assignedFoEmail: email,
    },
  });

  await client.requestHistory.updateMany({
    where: { userId: sourceUserId },
    data: {
      userId: targetUserId,
      userName: actorName || email,
    },
  });
}

type AuthedRequest = Request & {
  user?: {
    uid?: string;
    email?: string;
    name?: string;
  };
  firebaseUid?: string;
  firebaseEmail?: string;
};

type WorkflowRole = 'FO' | 'RH' | 'PAYMENT' | 'VENDOR' | 'ADMIN';

const normalizeVehicleKey = (value: string) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const parseRequestIdentifier = (requestId: string) => {
  const raw = String(requestId || '').trim();
  if (!raw) {
    return { numericId: 0, firebaseId: '' };
  }

  if (/^REQ-\d+$/i.test(raw)) {
    return { numericId: extractNumericId(raw.toUpperCase()), firebaseId: '' };
  }

  if (/^\d+$/.test(raw)) {
    return { numericId: parseInt(raw, 10), firebaseId: '' };
  }

  return { numericId: 0, firebaseId: raw };
};

async function resolveRequestByIdentifier(requestId: string) {
  const { numericId, firebaseId } = parseRequestIdentifier(requestId);

  if (numericId > 0) {
    return prisma.request.findUnique({
      where: { id: numericId },
      include: { vehicles: { orderBy: { id: 'asc' } }, history: true, ltpocDetails: true },
    });
  }

  if (firebaseId) {
    return prisma.request.findUnique({
      where: { firebaseId },
      include: { vehicles: { orderBy: { id: 'asc' } }, history: true, ltpocDetails: true },
    });
  }

  return null;
}

async function getOrCreateUserFromToken(req: AuthedRequest, options?: { allowNonCompanyCreation?: boolean }) {
  const uid = req.firebaseUid || '';
  const email = req.firebaseEmail || '';
  const emailNormalized = normalizeEmail(email);
  const nextName = String(req.user?.name || '').trim() || null;
  if (!uid || !email) {
    throw new Error('Unauthorized: token missing uid/email');
  }

  const existingById = await prisma.user.findUnique({
    where: { id: uid },
  });
  const existingByEmail = await findUserByEmailLoose(email);

  if (existingById && existingByEmail && existingById.id !== existingByEmail.id) {
    return prisma.$transaction(async (tx) => {
      await remapUserOwnership(tx, existingByEmail.id, existingById.id, email, emailNormalized, nextName || existingById.name || existingByEmail.name || email);
      await tx.user.delete({ where: { id: existingByEmail.id } });

      return tx.user.update({
        where: { id: existingById.id },
        data: {
          email,
          emailNormalized,
          name: nextName || existingById.name || existingByEmail.name || null,
          role: existingById.role || existingByEmail.role,
          employeeId: existingById.employeeId || existingByEmail.employeeId,
          phoneNumber: existingById.phoneNumber || existingByEmail.phoneNumber,
          profileCompleted: existingById.profileCompleted || existingByEmail.profileCompleted,
        },
      });
    });
  }

  if (existingById) {
    if (existingByEmail && existingByEmail.id !== existingById.id) {
      await prisma.$transaction(async (tx) => {
        await remapUserOwnership(tx, existingByEmail.id, existingById.id, email, emailNormalized, nextName || existingById.name || existingByEmail.name || email);
        await tx.user.delete({ where: { id: existingByEmail.id } });
      });
    }

    const emailNeedsSync = existingById.email !== email || existingById.emailNormalized !== emailNormalized;
    const nameNeedsSync = existingById.name !== nextName;

    if (emailNeedsSync || nameNeedsSync) {
      return prisma.user.update({
        where: { id: existingById.id },
        data: {
          ...(emailNeedsSync ? { email, emailNormalized } : {}),
          ...(nameNeedsSync ? { name: nextName } : {}),
        },
      });
    }

    return existingById;
  }

  if (existingByEmail) {
    const resolvedName = nextName || existingByEmail.name || email;

    if (existingByEmail.id !== uid) {
      return prisma.$transaction(async (tx) => {
        await remapUserOwnership(tx, existingByEmail.id, uid, email, emailNormalized, resolvedName);
        await tx.user.delete({ where: { id: existingByEmail.id } });

        return tx.user.create({
          data: {
            id: uid,
            email,
            emailNormalized,
            name: resolvedName,
            role: existingByEmail.role,
            employeeId: existingByEmail.employeeId,
            phoneNumber: existingByEmail.phoneNumber,
            profileCompleted: existingByEmail.profileCompleted,
          },
        });
      });
    }

    return prisma.user.update({
      where: { id: uid },
      data: {
        email,
        emailNormalized,
        name: resolvedName,
        role: existingByEmail.role,
        employeeId: existingByEmail.employeeId,
        phoneNumber: existingByEmail.phoneNumber,
        profileCompleted: existingByEmail.profileCompleted,
      },
    });
  }

  const allowNonCompanyCreation = options?.allowNonCompanyCreation === true;

  // Allow legacy/non-company users to bootstrap their profile when hitting /users/me.
  // Keep the stricter company-domain rule for operational routes.
  if (!isCompanyEmail(email) && !allowNonCompanyCreation) {
    throw new Error(`FORBIDDEN_NEW_USERS_MUST_USE_COMPANY_EMAIL:@${allowedDomain}`);
  }

  try {
    return await prisma.user.create({
      data: {
        id: uid,
        email,
        emailNormalized,
        name: req.user?.name || null,
        role: null,
      },
    });
  } catch (error) {
    // Handle races where another request creates the user first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const recovered =
        (await prisma.user.findUnique({ where: { id: uid } })) ||
        (await prisma.user.findUnique({ where: { emailNormalized } }));
      if (recovered) {
        return recovered;
      }
    }
    throw error;
  }
}

function normalizeRole(role: string | null | undefined): string {
  return String(role || '').trim().toUpperCase();
}

function ensureRole(userRole: string | null | undefined, allowed: WorkflowRole[]) {
  const current = normalizeRole(userRole);
  if (!allowed.includes(current as WorkflowRole) && current !== 'SUPER_ADMIN') {
    throw new Error(`FORBIDDEN_${allowed.join('_OR_')}_ONLY`);
  }
}

async function addHistory(
  requestId: number,
  actor: { id: string; role?: string | null; name?: string | null; email?: string | null },
  action: string,
  statusFrom: string | null,
  statusTo: string | null,
  notes?: string,
) {
  await prisma.requestHistory.create({
    data: {
      requestId,
      userId: actor.id,
      userName: actor.name || actor.email || null,
      role: normalizeRole(actor.role),
      action,
      statusFrom,
      statusTo,
      notes: notes || null,
    },
  });
}

function handleProfileError(error: unknown, res: Response, action: 'fetch' | 'update') {
  const message = error instanceof Error ? error.message : '';

  if (message.startsWith('Unauthorized:')) {
    return res.status(401).json({ error: message });
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return res.status(503).json({
      error: `Database is unavailable while trying to ${action} user profile.`,
      details: message || 'Check DATABASE_URL and database availability.',
    });
  }

  if (message.startsWith('FORBIDDEN_')) {
    return res.status(403).json({ error: 'Forbidden', details: message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
    return res.status(503).json({
      error: 'Database schema is not initialized.',
      details: 'Run Prisma schema sync/migrations before serving traffic.',
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
    return res.status(503).json({
      error: 'Database schema is out of date.',
      details: 'A required column is missing. Run Prisma schema sync/migrations before serving traffic.',
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return res.status(409).json({
      error: 'User profile conflict detected.',
      details: 'A user with this email already exists and must be reconciled.',
    });
  }

  return res.status(500).json({ error: `Failed to ${action} user profile` });
}

function formatRequestResponse(record: { id: number; firebaseId: string | null }) {
  return {
    requestId: formatRequestId(record.id),
    numericId: record.id,
    firebaseId: record.firebaseId,
  };
}

const toIsoString = (value: Date | null | undefined) => (value instanceof Date ? value.toISOString() : null);

const normalizePhone = (value: unknown) => String(value || '').replace(/\D/g, '').slice(0, 10);

const resolveProfileCompleted = (profile: {
  profileCompleted?: boolean | null;
  name?: string | null;
  employeeId?: string | null;
  phoneNumber?: string | null;
}) => {
  if (profile.profileCompleted === true) {
    return true;
  }

  const name = String(profile.name || '').trim();
  const employeeId = String(profile.employeeId || '').trim();
  const phone = normalizePhone(profile.phoneNumber || '');
  return Boolean(name && employeeId && /^\d{10}$/.test(phone));
};

const mapRequestRecord = (record: any) => {
  const requestDisplayId = String(record.requestDisplayId || '').trim() || formatRequestId(record.id);
  const ltpocRows = Array.isArray(record.ltpocDetails)
    ? record.ltpocDetails
    : Array.isArray(record.lptocDetails)
    ? record.lptocDetails
    : [];
  const ltpocByVehicle = new Map(
    ltpocRows
      .map((row: any) => [normalizeVehicleKey(String(row?.vehicleNumber || '')), row] as const)
        .filter((entry: [string, any]) => Boolean(entry[0]))
  );

  return {
    id: requestDisplayId,
    requestId: requestDisplayId,
    requestDisplayId,
    requestSequence: record.id,
    numericId: record.id,
    firebaseId: record.firebaseId ?? null,
    status: record.status ?? 'PARALLEL_REVIEW',
    createdBy: record.createdBy ?? null,
    createdByEmail: record.createdByEmail ?? null,
    city: record.city ?? '',
    clientName: record.clientName ?? '',
    isBulkRequest: Boolean(record.isBulkRequest),
    vehicleCount: Number(record.vehicleCount || 0),
    assignedRhUserId: record.assignedRhUserId ?? null,
    assignedRhEmail: record.assignedRhEmail ?? null,
    assignedRhEmailNormalized: record.assignedRhEmailNormalized ?? null,
    rhStatus: record.rhStatus ?? null,
    rhApproval: Boolean(record.rhApproval),
    rhApprovedAt: toIsoString(record.rhApprovedAt),
    rhApprovalNotes: record.rhApprovalNotes ?? null,
    rhRejectedAt: toIsoString(record.rhRejectedAt),
    rejectionReason: record.rejectionReason ?? null,
    paymentStatus: record.paymentStatus ?? null,
    paymentApproved: Boolean(record.paymentApproved),
    paymentRejected: Boolean(record.paymentRejected),
    paymentActionTaken: Boolean(record.paymentActionTaken),
    paymentApprovedAt: toIsoString(record.paymentApprovedAt),
    paymentRejectedAt: toIsoString(record.paymentRejectedAt),
    paymentApproverName: record.paymentApproverName ?? null,
    vendorName: record.vendorName ?? null,
    vendorStatus: record.vendorStatus ?? null,
    vendorNotified: Boolean(record.vendorNotified),
    vendorApprovedBy: record.vendorApprovedBy ?? null,
    vendorApprovedAt: toIsoString(record.vendorApprovedAt),
    vendorBulkMailSentAt: toIsoString(record.vendorBulkMailSentAt),
    assignedFoId: record.assignedFoId ?? null,
    assignedFoEmail: record.assignedFoEmail ?? null,
    foNotified: Boolean(record.foNotified),
    foNotifiedAt: toIsoString(record.foNotifiedAt),
    foBulkNotifyEnabled: Boolean(record.foBulkNotifyEnabled),
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
    vehicles: Array.isArray(record.vehicles)
      ? record.vehicles.map((vehicle: any, index: number) => {
          const vehicleKey = normalizeVehicleKey(String(vehicle?.vehicleNumber || ''));
          const ltpoc = ltpocByVehicle.get(vehicleKey) || ltpocRows[index] || null;

          return {
            vehicleNumber: vehicle.vehicleNumber ?? '',
            city: vehicle.city ?? '',
            serviceType: vehicle.serviceType ?? '',
            rhRejected: Boolean(vehicle.rhRejected),
            rhRejectionReason: vehicle.rhRejectionReason ?? null,
            paymentApproved: Boolean(vehicle.paymentApproved),
            paymentRejected: Boolean(vehicle.paymentRejected),
            paymentActionTaken: Boolean(vehicle.paymentActionTaken),
            paymentApprovedAt: toIsoString(vehicle.paymentApprovedAt),
            paymentRejectedAt: toIsoString(vehicle.paymentRejectedAt),
            paymentRejectionReason: vehicle.paymentRejectionReason ?? null,
            vendorNotified: Boolean(vehicle.vendorNotified),
            vendorName: vehicle.vendorName ?? null,
            vehicleAvailabilityLocation: vehicle.vehicleAvailabilityLocation ?? '',
            vehicleAvailableTime: vehicle.vehicleAvailableTime ?? '',
            ltpocName: ltpoc?.ltpocName ?? ltpoc?.lptocName ?? vehicle?.ltpocName ?? vehicle?.lptocName ?? '',
            ltpocPhone: ltpoc?.ltpocPhone ?? ltpoc?.lptocPhone ?? vehicle?.ltpocPhone ?? vehicle?.lptocPhone ?? '',
            serviceCost: null,
            isVehicleDropped: Boolean(vehicle.rhRejected) || Boolean(vehicle.paymentRejected),
          };
        })
      : [],
    ltpocDetails: ltpocRows.length > 0
      ? ltpocRows.map((row: any) => ({
          vehicleNumber: row.vehicleNumber ?? '',
          ltpocName: row.ltpocName ?? row.lptocName ?? '',
          ltpocPhone: row.ltpocPhone ?? row.lptocPhone ?? '',
        }))
      : [],
    history: Array.isArray(record.history)
      ? record.history.map((entry: any) => ({
          userId: entry.userId ?? null,
          userName: entry.userName ?? null,
          role: entry.role ?? null,
          action: entry.action ?? null,
          statusFrom: entry.statusFrom ?? null,
          statusTo: entry.statusTo ?? null,
          notes: entry.notes ?? null,
          timestamp: toIsoString(entry.createdAt),
        }))
      : [],
  };
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Format request ID to REQ-00001 format
 */
export function formatRequestId(numId: number): string {
  return `REQ-${String(numId).padStart(6, '0')}`;
}

/**
 * Extract numeric ID from formatted request ID
 */
export function extractNumericId(formattedId: string): number {
  const match = formattedId.match(/REQ-(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Check if email is from allowed domain
 */
function isCompanyEmail(email: string): boolean {
  const lowerEmail = email.toLowerCase();
  return lowerEmail.endsWith(`@${allowedDomain.toLowerCase()}`);
}

async function isExistingLegacyUser(uid: string): Promise<boolean> {
  if (!uid) {
    return false;
  }

  const existing = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true },
  });

  return Boolean(existing);
}

async function findExistingUserByTokenIdentity(uid: string, email: string) {
  if (uid) {
    const byId = await prisma.user.findUnique({
      where: { id: uid },
    });

    if (byId) {
      return byId;
    }
  }

  return findUserByEmailLoose(email);
}

/**
 * Firebase token verification middleware
 */
async function verifyFirebaseToken(req: Request, res: Response, next: NextFunction) {
  if (!auth) {
    return res.status(503).json({
      error: 'Firebase Admin is not configured.',
      details: 'Set FIREBASE_SERVICE_ACCOUNT_PATH and FIREBASE_PROJECT_ID before serving authenticated requests.',
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.substring(7);
  try {
    const decodedToken = await auth.verifyIdToken(token);
    (req as any).user = decodedToken;
    (req as any).firebaseUid = decodedToken.uid;
    (req as any).firebaseEmail = decodedToken.email;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

/**
 * Company email domain check middleware
 */
async function checkCompanyDomain(req: Request, res: Response, next: NextFunction) {
  try {
    await getOrCreateUserFromToken(req as AuthedRequest, { allowNonCompanyCreation: false });
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    if (message.startsWith('FORBIDDEN_NEW_USERS_MUST_USE_COMPANY_EMAIL:')) {
      return res.status(403).json({
        error: `Forbidden: Only @${allowedDomain} email addresses are allowed for new users`,
      });
    }

    if (message.startsWith('Unauthorized:')) {
      return res.status(401).json({ error: message });
    }

    console.error('Domain check failed:', error);
    return res.status(500).json({ error: 'Failed to verify authenticated user.' });
  }
}

// ============================================================
// PUBLIC ENDPOINTS (No auth required)
// ============================================================

/**
 * API root endpoint
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'gps-api',
    status: 'ok',
    message: 'API is running. Use /health and /health/db for checks.',
    endpoints: ['/health', '/health/db', '/test/request-id'],
    timestamp: new Date().toISOString(),
  });
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Database connectivity check
 */
app.get('/health/db', async (req: Request, res: Response) => {
  try {
    const result = await prisma.$queryRaw`SELECT 1 as "connection"`;
    return res.json({ status: 'ok', database: 'connected', result });
  } catch (error) {
    console.error('DB health check failed:', error);
    return res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

/**
 * Test endpoint to demonstrate request ID formatting
 */
app.get('/test/request-id', (req: Request, res: Response) => {
  const testIds = [1, 100, 1234, 10000, 99999];
  const formatted = testIds.map((id) => ({
    numeric: id,
    formatted: formatRequestId(id),
  }));
  res.json({ requestIdFormat: 'REQ-XXXXXX', examples: formatted });
});

/**
 * Send OTP email (public, used before/without authenticated session)
 */
app.post('/sendOTP', async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim();
    const otp = String(req.body?.otp || '').trim();

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required.' });
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || 'no-reply@gps-automation.local';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return res.status(503).json({
        error: 'Failed to send OTP.',
        details: 'SMTP is not configured on API server.',
      });
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false',
      },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: 'Your verification code',
      text: `Your OTP is ${otp}. It expires in 10 minutes.`,
    });

    await prisma.notification.create({
      data: {
        recipientEmail: email,
        recipientRole: 'USER',
        notificationType: 'OTP',
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('OTP send failed:', error);
    return res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// ============================================================
// PROTECTED ENDPOINTS (Auth + company domain required)
// ============================================================

/**
 * Get user profile
 */
app.get('/users/me', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const user = await getOrCreateUserFromToken(req as AuthedRequest, { allowNonCompanyCreation: true });

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      employeeId: user.employeeId,
      phoneNumber: user.phoneNumber,
      role: user.role,
      profileCompleted: user.profileCompleted,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return handleProfileError(error, res, 'fetch');
  }
});

app.patch('/users/me', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const user = await getOrCreateUserFromToken(req as AuthedRequest, { allowNonCompanyCreation: true });
    const body = (req.body ?? {}) as Record<string, unknown>;

    const nextRoleRaw = String(body.role || '').trim().toUpperCase();
    const nextRole = nextRoleRaw || null;
    const allowedRoles = new Set(['FO', 'RH', 'PAYMENT', 'VENDOR', 'ADMIN']);
    if (nextRole && !allowedRoles.has(nextRole)) {
      return res.status(400).json({ error: 'Invalid role value.' });
    }

    if (nextRole && user.role && normalizeRole(user.role) !== nextRole && normalizeRole(user.role) !== 'ADMIN' && normalizeRole(user.role) !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Role change not permitted.' });
    }

    const name = body.name === undefined ? user.name : String(body.name || '').trim() || null;
    const employeeId = body.employeeId === undefined ? user.employeeId : String(body.employeeId || '').trim() || null;
    const phoneNumber = body.phoneNumber === undefined
      ? user.phoneNumber
      : (() => {
          const normalized = normalizePhone(body.phoneNumber);
          return normalized ? normalized : null;
        })();

    const profileCompleted = resolveProfileCompleted({
      profileCompleted: body.profileCompleted === true,
      name,
      employeeId,
      phoneNumber,
    });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(nextRole ? { role: nextRole } : {}),
        name,
        employeeId,
        phoneNumber,
        profileCompleted,
      },
    });

    return res.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      employeeId: updated.employeeId,
      phoneNumber: updated.phoneNumber,
      role: updated.role,
      profileCompleted: updated.profileCompleted,
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return handleProfileError(error, res, 'update');
  }
});

/**
 * List all requests for testing
 */
app.get('/requests', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    await getOrCreateUserFromToken(req as AuthedRequest);

    const requestedLimit = Number(req.query.limit || 5000);
    const take = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 10000) : 5000;

    const requests = await prisma.request.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicles: { orderBy: { id: 'asc' } },
        history: { orderBy: { createdAt: 'asc' } },
        ltpocDetails: { orderBy: { id: 'asc' } },
      },
    });

    const formatted = requests.map((request) => mapRequestRecord(request));

    return res.json({ total: requests.length, requests: formatted });
  } catch (error) {
    console.error('Error fetching requests:', error);
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

app.post('/requests', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['FO', 'ADMIN']);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const vehicles = Array.isArray(body.vehicles) ? body.vehicles : [];
    const ltpocDetails = Array.isArray(body.ltpocDetails)
      ? body.ltpocDetails
      : Array.isArray((body as Record<string, unknown>).lptocDetails)
      ? ((body as Record<string, unknown>).lptocDetails as unknown[])
      : [];
    const incomingHistory = Array.isArray(body.history) ? body.history : [];

    // Log if ltpocDetails structure is unexpected
    if (body.ltpocDetails !== undefined && !Array.isArray(body.ltpocDetails) && !Array.isArray((body as Record<string, unknown>).lptocDetails)) {
      console.warn(`[LTPOC] Unexpected ltpocDetails type in request: ${typeof body.ltpocDetails}`);
    }

    const baseStatus = String(body.status || 'PARALLEL_REVIEW').trim().toUpperCase() || 'PARALLEL_REVIEW';

    const createPayload = {
      firebaseId: String(body.id || '').trim() || null,
      status: baseStatus,
      createdBy: actor.id,
      createdByEmail: actor.email,
      city: String(body.city || '').trim() || null,
      clientName: String(body.clientName || '').trim() || null,
      isBulkRequest: body.isBulkRequest === true,
      vehicleCount: Number(body.vehicleCount || vehicles.length || 0),
      assignedRhUserId: String(body.assignedRhUserId || '').trim() || null,
      assignedRhEmail: String(body.assignedRhEmail || '').trim().toLowerCase() || null,
      assignedRhEmailNormalized: String(body.assignedRhEmailNormalized || body.assignedRhEmail || '').trim().toLowerCase() || null,
      rhStatus: String(body.rhStatus || '').trim().toUpperCase() || null,
      rhApproval: body.rhApproval === true,
      paymentStatus: String(body.paymentStatus || '').trim().toUpperCase() || 'PENDING',
      paymentApproved: body.paymentApproved === true,
      paymentRejected: body.paymentRejected === true,
      paymentActionTaken: body.paymentActionTaken === true,
      vendorName: String(body.vendorName || '').trim() || null,
      vendorStatus: String(body.vendorStatus || '').trim().toUpperCase() || null,
      vendorNotified: body.vendorNotified === true,
      foNotified: body.foNotified === true,
      foBulkNotifyEnabled: body.foBulkNotifyEnabled === true,
      vehicles: {
        create: vehicles.map((vehicle: any) => ({
          vehicleNumber: String(vehicle?.vehicleNumber || '').trim() || null,
          city: String(vehicle?.city || body.city || '').trim() || null,
          serviceType: String(vehicle?.serviceType || body.serviceType || '').trim() || null,
          vehicleAvailabilityLocation: String(vehicle?.vehicleAvailabilityLocation || body.vehicleAvailabilityLocation || '').trim() || null,
          vehicleAvailableTime: String(vehicle?.vehicleAvailableTime || body.vehicleAvailableTime || '').trim() || null,
          paymentApproved: vehicle?.paymentApproved === true,
          paymentRejected: vehicle?.paymentRejected === true,
          paymentActionTaken: vehicle?.paymentActionTaken === true,
          paymentRejectionReason: String(vehicle?.paymentRejectionReason || '').trim() || null,
          rhRejected: vehicle?.rhRejected === true,
          rhRejectionReason: String(vehicle?.rhRejectionReason || '').trim() || null,
          vendorNotified: vehicle?.vendorNotified === true,
          vendorName: String(vehicle?.vendorName || '').trim() || null,
        })),
      },
      ltpocDetails: {
        create: ltpocDetails
          .map((row: any) => ({
            vehicleNumber: String(row?.vehicleNumber || '').trim() || null,
            ltpocName: String(row?.ltpocName || row?.lptocName || '').trim() || null,
            ltpocPhone: normalizePhone(row?.ltpocPhone || row?.lptocPhone || ''),
          }))
          .filter((row: any) => row.vehicleNumber || row.ltpocName || row.ltpocPhone), // Only save rows with at least one field
      },
      history: {
        create: incomingHistory.length > 0
          ? incomingHistory.map((entry: any) => ({
              userId: String(entry?.userId || actor.id || '').trim() || null,
              userName: String(entry?.userName || actor.name || actor.email || '').trim() || null,
              role: String(entry?.role || actor.role || 'FO').trim().toUpperCase() || 'FO',
              action: String(entry?.action || 'CREATE').trim().toUpperCase() || 'CREATE',
              statusFrom: entry?.statusFrom ? String(entry.statusFrom).trim().toUpperCase() : null,
              statusTo: entry?.statusTo ? String(entry.statusTo).trim().toUpperCase() : baseStatus,
              notes: String(entry?.notes || 'Request created').trim() || null,
            }))
          : [{
              userId: actor.id,
              userName: actor.name || actor.email || null,
              role: normalizeRole(actor.role),
              action: 'CREATE',
              statusFrom: null,
              statusTo: baseStatus,
              notes: 'Request created',
            }],
      },
    };

    const created = await prisma.request.create({
      data: createPayload,
      include: {
        vehicles: { orderBy: { id: 'asc' } },
        history: { orderBy: { createdAt: 'asc' } },
        ltpocDetails: { orderBy: { id: 'asc' } },
      },
    });

    const persistedRequestDisplayId = formatRequestId(created.id);
    await prisma.$executeRawUnsafe(
      'UPDATE "Request" SET "requestDisplayId" = $1 WHERE id = $2',
      persistedRequestDisplayId,
      created.id,
    );

    const createdWithDisplayId = await prisma.request.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        vehicles: { orderBy: { id: 'asc' } },
        history: { orderBy: { createdAt: 'asc' } },
        ltpocDetails: { orderBy: { id: 'asc' } },
      },
    });

    return res.status(201).json({ success: true, request: mapRequestRecord(createdWithDisplayId), requestId: persistedRequestDisplayId });
  } catch (error) {
    const message = (error as Error).message || 'Failed to create request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    console.error('Error creating request:', error);
    return res.status(500).json({ error: 'Failed to create request', details: message });
  }
});

/**
 * Get single request
 */
app.get('/requests/:requestId', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    await getOrCreateUserFromToken(req as AuthedRequest);
    const request = await resolveRequestByIdentifier(req.params.requestId);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    return res.json(mapRequestRecord(request));
  } catch (error) {
    console.error('Error fetching request:', error);
    return res.status(500).json({ error: 'Failed to fetch request' });
  }
});

/**
 * Get requests assigned to current RH
 */
app.get('/requests/for-rh', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const user = await getOrCreateUserFromToken(req as AuthedRequest);
    
    if (user.role !== 'RH' && user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: RH and ADMIN roles only' });
    }

    const uid = String(user.id || '').trim();
    const email = String(user.email || '').trim().toLowerCase();

    const requests = await prisma.request.findMany({
      where: {
        OR: [
          { assignedRhUserId: uid },
          { assignedRhEmailNormalized: email },
          { assignedRhEmail: { equals: email, mode: 'insensitive' } },
        ],
      },
      include: {
        vehicles: { orderBy: { id: 'asc' } },
        history: { orderBy: { createdAt: 'asc' } },
        ltpocDetails: { orderBy: { id: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = requests.map((request) => mapRequestRecord(request));
    return res.json(formatted);
  } catch (error) {
    console.error('Error fetching RH requests:', error);
    return res.status(500).json({ error: 'Failed to fetch RH requests' });
  }
});

/**
 * List users with optional role filter
 */
app.get('/users', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    await getOrCreateUserFromToken(req as AuthedRequest);
    
    const roleFilter = String(req.query.role || '').trim().toUpperCase();
    const allowedRoles = new Set(['FO', 'RH', 'PAYMENT', 'VENDOR', 'ADMIN']);
    
    const where = roleFilter && allowedRoles.has(roleFilter)
      ? { role: roleFilter }
      : {};

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
      orderBy: { email: 'asc' },
    });

    const formatted = users.map((user: any) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      displayName: user.name || user.email?.split('@')[0] || 'User',
      role: user.role,
    }));

    return res.json(formatted);
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/rhEditApproveRequest', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['RH', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const updates = (req.body?.updates ?? {}) as Record<string, unknown>;
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const previousStatus = found.status;
    const nextStatus = found.paymentApproved ? 'VENDOR_COORDINATION' : 'PARALLEL_REVIEW';

    const updated = await prisma.request.update({
      where: { id: found.id },
      data: {
        city: updates.city !== undefined ? String(updates.city || '').trim() || null : found.city,
        clientName: updates.clientName !== undefined ? String(updates.clientName || '').trim() || null : found.clientName,
        rhStatus: 'APPROVED',
        rhApproval: true,
        rhApprovedAt: new Date(),
        rejectionReason: null,
        status: nextStatus,
      },
    });

    await addHistory(found.id, actor, 'RH_EDIT_APPROVE', previousStatus || null, nextStatus, 'RH edited and approved request');
    return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status });
  } catch (error) {
    const message = (error as Error).message || 'Failed to edit and approve request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to edit and approve request', details: message });
  }
});

app.post('/paymentApproveRequest', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['PAYMENT', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const previousStatus = found.status;
    const now = new Date();
    const updated = await prisma.request.update({
      where: { id: found.id },
      data: {
        paymentApproved: true,
        paymentRejected: false,
        paymentActionTaken: true,
        paymentStatus: 'APPROVED',
        paymentApprovedAt: now,
        paymentRejectedAt: null,
        paymentApproverName: actor.name || actor.email || null,
        status: 'VENDOR_COORDINATION',
      },
    });

    await prisma.requestVehicle.updateMany({
      where: { requestId: found.id },
      data: {
        paymentApproved: true,
        paymentRejected: false,
        paymentActionTaken: true,
        paymentApprovedAt: now,
        paymentRejectedAt: null,
        paymentRejectionReason: null,
      },
    });

    await addHistory(found.id, actor, 'PAYMENT_APPROVE', previousStatus || null, 'VENDOR_COORDINATION', 'Payment approved request');
    return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status });
  } catch (error) {
    const message = (error as Error).message || 'Failed to approve payment request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to approve payment request', details: message });
  }
});

app.post('/paymentRejectRequest', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['PAYMENT', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const rejectionReason = String(req.body?.rejectionReason || '').trim() || 'Rejected by Payment';
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const previousStatus = found.status;
    const now = new Date();

    const updated = await prisma.request.update({
      where: { id: found.id },
      data: {
        paymentApproved: false,
        paymentRejected: true,
        paymentActionTaken: true,
        paymentStatus: 'REJECTED',
        paymentApprovedAt: null,
        paymentRejectedAt: now,
        paymentApproverName: actor.name || actor.email || null,
        status: 'HALTED',
        rejectionReason,
      },
    });

    await prisma.requestVehicle.updateMany({
      where: { requestId: found.id },
      data: {
        paymentApproved: false,
        paymentRejected: true,
        paymentActionTaken: true,
        paymentApprovedAt: null,
        paymentRejectedAt: now,
        paymentRejectionReason: rejectionReason,
      },
    });

    await addHistory(found.id, actor, 'PAYMENT_REJECT', previousStatus || null, 'HALTED', `Payment rejected request: ${rejectionReason}`);
    return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status, reason: rejectionReason });
  } catch (error) {
    const message = (error as Error).message || 'Failed to reject payment request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to reject payment request', details: message });
  }
});

/**
 * RH directory for request assignment UI
 */
app.get('/listRhDirectory', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const caller = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(caller.role, ['FO', 'ADMIN']);

    const rows = await prisma.user.findMany({
      where: {
        OR: [
          { role: { equals: 'RH', mode: 'insensitive' } },
          { role: { equals: 'REGIONAL_HEAD', mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true },
      orderBy: { email: 'asc' },
    });

    return res.json({ success: true, data: rows });
  } catch (error) {
    const message = (error as Error).message || 'Failed to fetch RH directory';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to fetch RH directory', details: message });
  }
});

/**
 * Vehicle validation endpoint used by FO form
 */
app.post('/validateVehicle', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const vehicleNumber = String(req.body?.vehicleNumber || '').trim().toUpperCase();
    if (!vehicleNumber) {
      return res.status(400).json({ error: 'vehicleNumber is required.' });
    }

    const vehicle = await prisma.requestVehicle.findFirst({
      where: {
        vehicleNumber: {
          equals: vehicleNumber,
          mode: 'insensitive',
        },
        rhRejected: false,
        paymentRejected: false,
        request: {
          status: {
            notIn: ['HALTED', 'CANCELLED'],
          },
        },
      },
      include: {
        request: {
          select: { clientName: true, city: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!vehicle) {
      return res.json({
        success: true,
        data: {
          vehicleNumber,
          isRegistered: false,
          city: '',
          clientName: '',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        vehicleNumber,
        isRegistered: true,
        city: vehicle.city || vehicle.request.city || '',
        clientName: vehicle.request.clientName || '',
      },
    });
  } catch (error) {
    console.error('validateVehicle failed:', error);
    return res.status(500).json({ error: 'Failed to validate vehicle.' });
  }
});

/**
 * Vehicle directory endpoint used by FO form
 */
app.get('/vehicles', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const rows = await prisma.requestVehicle.findMany({
      where: { vehicleNumber: { not: null } },
      include: {
        request: {
          select: { clientName: true, city: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const byVehicle = new Map<string, { vehicleNumber: string; city: string; clientName: string; isRegistered: boolean }>();
    for (const row of rows) {
      const vehicleNumber = String(row.vehicleNumber || '').trim().toUpperCase();
      if (!vehicleNumber) {
        continue;
      }
      const key = normalizeVehicleKey(vehicleNumber);
      if (byVehicle.has(key)) {
        continue;
      }
      byVehicle.set(key, {
        vehicleNumber,
        city: row.city || row.request.city || '',
        clientName: row.request.clientName || '',
        isRegistered: true,
      });
    }

    return res.json({ success: true, data: Array.from(byVehicle.values()) });
  } catch (error) {
    console.error('vehicles failed:', error);
    return res.status(500).json({ error: 'Failed to fetch vehicles list.' });
  }
});

app.post('/rhApproveRequest', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['RH', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const previousStatus = found.status;
    const nextStatus = found.paymentApproved ? 'VENDOR_COORDINATION' : 'PARALLEL_REVIEW';

    const updated = await prisma.request.update({
      where: { id: found.id },
      data: {
        rhStatus: 'APPROVED',
        rhApproval: true,
        rhApprovedAt: new Date(),
        rejectionReason: null,
        status: nextStatus,
      },
    });

    await addHistory(found.id, actor, 'RH_APPROVE', previousStatus || null, nextStatus, 'RH approved request');
    return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status });
  } catch (error) {
    const message = (error as Error).message || 'Failed to approve request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to approve request', details: message });
  }
});

app.post('/rhRejectRequest', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['RH', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const rejectionReason = String(req.body?.rejectionReason || '').trim();
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const previousStatus = found.status;
    const reason = rejectionReason || 'Rejected by RH';
    const now = new Date();

    const updated = await prisma.request.update({
      where: { id: found.id },
      data: {
        rhStatus: 'REJECTED',
        rhApproval: false,
        rhApprovedAt: null,
        rhRejectedAt: now,
        rejectionReason: reason,
        status: 'HALTED',
      },
    });

    await prisma.requestVehicle.updateMany({
      where: { requestId: found.id },
      data: {
        rhRejected: true,
        rhRejectionReason: reason,
      },
    });

    await addHistory(found.id, actor, 'RH_REJECT', previousStatus || null, 'HALTED', `RH rejected request: ${reason}`);
    return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status, reason });
  } catch (error) {
    const message = (error as Error).message || 'Failed to reject request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to reject request', details: message });
  }
});

app.post('/foCancelRequest', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['FO', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const previousStatus = found.status;
    const updated = await prisma.request.update({
      where: { id: found.id },
      data: {
        status: 'CANCELLED',
      },
    });

    await addHistory(found.id, actor, 'FO_CANCEL', previousStatus || null, 'CANCELLED', 'FO cancelled request');
    return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status });
  } catch (error) {
    const message = (error as Error).message || 'Failed to cancel request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to cancel request', details: message });
  }
});

app.post('/foRemoveBulkVehicle', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['FO', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const vehicleNumber = String(req.body?.vehicleNumber || '').trim();
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!found.isBulkRequest) {
      return res.status(400).json({ error: 'Vehicle removal is allowed only for bulk requests.' });
    }

    const targetKey = normalizeVehicleKey(vehicleNumber);
    const existing = found.vehicles;
    const remaining = existing.filter((row) => normalizeVehicleKey(String(row.vehicleNumber || '')) !== targetKey);

    if (remaining.length === existing.length) {
      return res.status(404).json({ error: `Vehicle ${vehicleNumber} not found in request.` });
    }
    if (remaining.length === 0) {
      return res.status(400).json({ error: 'Cannot remove last vehicle. Use reject/cancel instead.' });
    }

    const removeIds = existing
      .filter((row) => normalizeVehicleKey(String(row.vehicleNumber || '')) === targetKey)
      .map((row) => row.id);

    await prisma.requestVehicle.deleteMany({ where: { id: { in: removeIds } } });
    await prisma.request.update({ where: { id: found.id }, data: { vehicleCount: remaining.length } });
    await addHistory(found.id, actor, 'FO_REMOVE_VEHICLE', found.status || null, found.status || null, `FO removed vehicle ${vehicleNumber}`);

    return res.json({ success: true, removedVehicle: vehicleNumber, remainingVehicles: remaining.length, ...formatRequestResponse(found) });
  } catch (error) {
    const message = (error as Error).message || 'Failed to remove vehicle from bulk request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to remove vehicle from bulk request', details: message });
  }
});

app.post('/rhRemoveBulkVehicle', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['RH', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const vehicleNumber = String(req.body?.vehicleNumber || '').trim();
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!found.isBulkRequest) {
      return res.status(400).json({ error: 'Vehicle removal is allowed only for bulk requests.' });
    }

    const targetKey = normalizeVehicleKey(vehicleNumber);
    const existing = found.vehicles;
    const remaining = existing.filter((row) => normalizeVehicleKey(String(row.vehicleNumber || '')) !== targetKey);

    if (remaining.length === existing.length) {
      return res.status(404).json({ error: `Vehicle ${vehicleNumber} not found in request.` });
    }
    if (remaining.length === 0) {
      return res.status(400).json({ error: 'Cannot remove last vehicle. Use reject/cancel instead.' });
    }

    const removeIds = existing
      .filter((row) => normalizeVehicleKey(String(row.vehicleNumber || '')) === targetKey)
      .map((row) => row.id);

    await prisma.requestVehicle.deleteMany({ where: { id: { in: removeIds } } });
    await prisma.request.update({ where: { id: found.id }, data: { vehicleCount: remaining.length } });
    await addHistory(found.id, actor, 'RH_REMOVE_VEHICLE', found.status || null, found.status || null, `RH removed vehicle ${vehicleNumber}`);

    return res.json({ success: true, removedVehicle: vehicleNumber, remainingVehicles: remaining.length, ...formatRequestResponse(found) });
  } catch (error) {
    const message = (error as Error).message || 'Failed to remove vehicle from bulk request';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to remove vehicle from bulk request', details: message });
  }
});

app.post('/rhRejectSingleVehicle', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['RH', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const vehicleNumber = String(req.body?.vehicleNumber || '').trim();
    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!found.isBulkRequest) {
      return res.status(400).json({ error: 'Vehicle rejection is allowed only for bulk requests.' });
    }

    const targetKey = normalizeVehicleKey(vehicleNumber);
    const target = found.vehicles.find((row) => normalizeVehicleKey(String(row.vehicleNumber || '')) === targetKey);
    if (!target) {
      return res.status(404).json({ error: `Vehicle ${vehicleNumber} not found in request.` });
    }

    await prisma.requestVehicle.delete({ where: { id: target.id } });
    await prisma.ltpocDetail.deleteMany({
      where: {
        requestId: found.id,
        vehicleNumber: {
          equals: String(target.vehicleNumber || vehicleNumber),
          mode: 'insensitive',
        },
      },
    });

    const remainingVehicles = await prisma.requestVehicle.count({ where: { requestId: found.id } });
    if (remainingVehicles <= 0) {
      const updated = await prisma.request.update({
        where: { id: found.id },
        data: {
          vehicleCount: 0,
          rhStatus: 'REJECTED',
          rhApproval: false,
          rhApprovedAt: null,
          rhRejectedAt: new Date(),
          rejectionReason: `All vehicles rejected by RH. Last rejected vehicle: ${vehicleNumber}`,
          status: 'HALTED',
        },
      });

      await addHistory(found.id, actor, 'RH_REJECT_SINGLE_VEHICLE', found.status || null, 'HALTED', `RH rejected last vehicle ${vehicleNumber}`);
      return res.json({ success: true, ...formatRequestResponse(updated), rejectedVehicle: vehicleNumber, remainingVehicles: 0, status: updated.status });
    }

    await prisma.request.update({
      where: { id: found.id },
      data: { vehicleCount: remainingVehicles },
    });

    await addHistory(found.id, actor, 'RH_REJECT_SINGLE_VEHICLE', found.status || null, found.status || null, `RH rejected vehicle ${vehicleNumber}`);
    return res.json({ success: true, requestId: formatRequestId(found.id), rejectedVehicle: vehicleNumber, remainingVehicles });
  } catch (error) {
    const message = (error as Error).message || 'Failed to reject single vehicle';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to reject single vehicle', details: message });
  }
});

app.post('/applyBulkPaymentAction', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['PAYMENT', 'ADMIN']);

    const requestId = String(req.body?.requestId || '').trim();
    const vehicleIndexes = Array.isArray(req.body?.vehicleIndexes) ? req.body.vehicleIndexes : [];
    const action = String(req.body?.action || '').trim().toUpperCase();
    const rejectionReason = String(req.body?.rejectionReason || '').trim();

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return res.status(400).json({ error: 'action must be APPROVE or REJECT' });
    }

    const found = await resolveRequestByIdentifier(requestId);
    if (!found) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!found.isBulkRequest) {
      return res.status(400).json({ error: 'Bulk payment action only applies to bulk requests.' });
    }

    const selectedRows = found.vehicles.filter((_, index) => vehicleIndexes.includes(index));
    if (selectedRows.length === 0) {
      return res.status(400).json({ error: 'No vehicles selected for payment action.' });
    }

    const now = new Date();
    if (action === 'APPROVE') {
      await prisma.requestVehicle.updateMany({
        where: { id: { in: selectedRows.map((v) => v.id) } },
        data: {
          paymentApproved: true,
          paymentRejected: false,
          paymentActionTaken: true,
          paymentApprovedAt: now,
          paymentRejectionReason: null,
        },
      });
    } else {
      const rejectIds = selectedRows.map((v) => v.id);
      const rejectedVehicleNumbers = selectedRows
        .map((row) => String(row.vehicleNumber || '').trim())
        .filter(Boolean);

      await prisma.requestVehicle.deleteMany({ where: { id: { in: rejectIds } } });

      if (rejectedVehicleNumbers.length > 0) {
        await prisma.ltpocDetail.deleteMany({
          where: {
            requestId: found.id,
            OR: rejectedVehicleNumbers.map((vehicle) => ({
              vehicleNumber: {
                equals: vehicle,
                mode: 'insensitive',
              },
            })),
          },
        });
      }
    }

    const refreshed = await prisma.requestVehicle.findMany({
      where: { requestId: found.id },
      orderBy: { id: 'asc' },
    });

    if (refreshed.length === 0) {
      const now = new Date();
      const updated = await prisma.request.update({
        where: { id: found.id },
        data: {
          vehicleCount: 0,
          status: 'HALTED',
          paymentStatus: 'REJECTED',
          paymentActionTaken: true,
          paymentApproved: false,
          paymentRejected: true,
          paymentApproverName: actor.name || actor.email,
          paymentApprovedAt: null,
          paymentRejectedAt: now,
          rejectionReason: rejectionReason || 'All vehicles rejected by Payment',
        },
      });

      await addHistory(
        found.id,
        actor,
        'PAYMENT_BULK_REJECT',
        found.status || null,
        'HALTED',
        `All vehicles rejected by Payment${rejectionReason ? `: ${rejectionReason}` : ''}`,
      );

      return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status, action });
    }

    const allProcessed = refreshed.every((row) => row.paymentActionTaken);
    const approvedCount = refreshed.filter((row) => row.paymentApproved).length;
    const rejectedCount = refreshed.filter((row) => row.paymentRejected).length;

    let nextStatus = found.status;
    let paymentStatus: string | null = 'PENDING';
    if (allProcessed && approvedCount > 0) {
      nextStatus = 'VENDOR_COORDINATION';
      paymentStatus = 'APPROVED';
    } else if (allProcessed && rejectedCount === refreshed.length) {
      nextStatus = 'HALTED';
      paymentStatus = 'REJECTED';
    } else {
      nextStatus = 'PARALLEL_REVIEW';
    }

    const updated = await prisma.request.update({
      where: { id: found.id },
      data: {
        vehicleCount: refreshed.length,
        status: nextStatus,
        paymentStatus,
        paymentActionTaken: true,
        paymentApproved: paymentStatus === 'APPROVED',
        paymentRejected: paymentStatus === 'REJECTED',
        paymentApproverName: actor.name || actor.email,
        paymentApprovedAt: paymentStatus === 'APPROVED' ? now : null,
        paymentRejectedAt: paymentStatus === 'REJECTED' ? now : null,
      },
    });

    const selectedVehicleNumbers = selectedRows.map((row) => row.vehicleNumber || 'N/A').join(', ');
    await addHistory(
      found.id,
      actor,
      action === 'APPROVE' ? 'PAYMENT_BULK_APPROVE' : 'PAYMENT_BULK_REJECT',
      found.status || null,
      nextStatus || null,
      action === 'REJECT'
        ? `Payment rejected vehicles: ${selectedVehicleNumbers}. Reason: ${rejectionReason || 'N/A'}`
        : `Payment approved vehicles: ${selectedVehicleNumbers}`,
    );

    return res.json({ success: true, ...formatRequestResponse(updated), status: updated.status, paymentStatus });
  } catch (error) {
    const message = (error as Error).message || 'Failed to apply bulk payment action';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to apply bulk payment action', details: message });
  }
});

app.post('/sendVendorBulkNotification', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['PAYMENT', 'ADMIN', 'VENDOR']);

    const vendorName = String(req.body?.vendorName || '').trim();
    const payloadRequestIds: string[] = Array.isArray(req.body?.requestIds)
      ? req.body.requestIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    const rawRequestIds = payloadRequestIds.length > 0
      ? payloadRequestIds
      : rows.map((row: any) => String(row?.requestId || '').trim()).filter(Boolean);

    const deduped: string[] = Array.from(new Set(rawRequestIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)));

    if (!vendorName || deduped.length === 0 || rows.length === 0) {
      return res.status(400).json({ error: 'vendorName and requestIds/rows are required.' });
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || 'no-reply@gps-automation.local';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return res.status(500).json({
        error: 'Failed to send vendor bulk notification',
        details: 'SMTP is not configured on API server.',
      });
    }

    const normalizeVendorKey = (value: string) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const vendorKey = normalizeVendorKey(vendorName);
    const vendorEmails = new Set<string>();

    const envMapRaw = String(process.env.VENDOR_EMAILS || '').trim();
    if (envMapRaw) {
      envMapRaw
        .split(/[;,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
          const separator = entry.includes('=') ? '=' : entry.includes(':') ? ':' : '';
          if (!separator) {
            return;
          }

          const [rawVendor, rawEmail] = entry.split(separator);
          const parsedVendor = normalizeVendorKey(rawVendor || '');
          const parsedEmail = String(rawEmail || '').trim().toLowerCase();
          if (parsedVendor === vendorKey && parsedEmail.includes('@')) {
            vendorEmails.add(parsedEmail);
          }
        });
    }

    const envSpecificKey = `VENDOR_EMAIL_${String(vendorName || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const envSpecificEmail = String((process.env as Record<string, string | undefined>)[envSpecificKey] || '').trim().toLowerCase();
    if (envSpecificEmail.includes('@')) {
      vendorEmails.add(envSpecificEmail);
    }

    // Backward compatible defaults used by the local dev email workflow.
    if (vendorEmails.size === 0) {
      if (vendorKey === 'fleetx') {
        vendorEmails.add('anupgogeri2@gmail.com');
      } else if (vendorKey === 'wheelseye') {
        vendorEmails.add('anupgogeri3@gmail.com');
      }
    }

    const vendorUsers = await prisma.user.findMany({
      where: { role: 'VENDOR' },
      select: { email: true, name: true },
    });

    for (const vendorUser of vendorUsers) {
      const userVendorKey = normalizeVendorKey(String(vendorUser.name || '').trim());
      if (userVendorKey && userVendorKey === vendorKey) {
        const email = String(vendorUser.email || '').trim().toLowerCase();
        if (email.includes('@')) {
          vendorEmails.add(email);
        }
      }
    }

    if (vendorEmails.size === 0) {
      return res.status(400).json({
        error: 'Failed to send vendor bulk notification',
        details: `No vendor email mapping found for ${vendorName}.`,
      });
    }

    const sanitize = (value: unknown) => String(value ?? '').trim();
    const normalizeVehicleNumberKey = (value: unknown) =>
      String(value || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

    const rawSanitizedRows = rows.map((row: any) => ({
      requestId: sanitize(row?.requestId),
      city: sanitize(row?.city),
      clientName: sanitize(row?.clientName),
      date: sanitize(row?.date),
      serviceType: sanitize(row?.serviceType),
      vehicleNumber: sanitize(row?.vehicleNumber),
      vehicleAvailabilityLocation: sanitize(row?.vehicleAvailabilityLocation),
      ltpocName: sanitize(row?.ltpocName ?? row?.lptocName),
      ltpocPhone: sanitize(row?.ltpocPhone ?? row?.lptocPhone),
    }));

    const requestCache = new Map<string, Awaited<ReturnType<typeof resolveRequestByIdentifier>> | null>();
    const getCachedRequest = async (requestId: string) => {
      if (requestCache.has(requestId)) {
        return requestCache.get(requestId) || null;
      }

      const found = await resolveRequestByIdentifier(requestId);
      requestCache.set(requestId, found || null);
      return found || null;
    };

    const sanitizedRows: Array<{
      requestId: string;
      city: string;
      clientName: string;
      date: string;
      serviceType: string;
      vehicleNumber: string;
      vehicleAvailabilityLocation: string;
      ltpocName: string;
      ltpocPhone: string;
    }> = [];

    for (const row of rawSanitizedRows) {
      let resolvedLtpocName = row.ltpocName;
      let resolvedLtpocPhone = row.ltpocPhone;

      if ((!resolvedLtpocName || !resolvedLtpocPhone) && row.requestId) {
        const found = await getCachedRequest(row.requestId);
        if (found) {
          const targetVehicleKey = normalizeVehicleNumberKey(row.vehicleNumber);
          const vehicleIndex = found.vehicles.findIndex(
            (vehicle) => normalizeVehicleNumberKey(vehicle.vehicleNumber) === targetVehicleKey
          );

          const ltpocMatch =
            found.ltpocDetails.find(
              (ltpoc) => normalizeVehicleNumberKey(ltpoc.vehicleNumber) === targetVehicleKey
            ) ||
            (vehicleIndex >= 0 && vehicleIndex < found.ltpocDetails.length
              ? found.ltpocDetails[vehicleIndex]
              : null);

          if (ltpocMatch) {
            const ltpocSource = ltpocMatch as unknown as Record<string, unknown>;
            if (!resolvedLtpocName) {
              resolvedLtpocName = String(ltpocSource.ltpocName || ltpocSource.lptocName || '').trim();
            }
            if (!resolvedLtpocPhone) {
              resolvedLtpocPhone = String(ltpocSource.ltpocPhone || ltpocSource.lptocPhone || '').trim();
            }
          }
        }
      }

      sanitizedRows.push({
        ...row,
        ltpocName: resolvedLtpocName,
        ltpocPhone: resolvedLtpocPhone,
      });
    }

    const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvHeaders = [
      'Request ID',
      'City',
      'Client',
      'Date',
      'Service Type',
      'Vehicle Number',
      'Vehicle Availability Location',
      'LTPOC Name',
      'LTPOC Phone',
    ];
    const csvLines = [
      csvHeaders.map(csvEscape).join(','),
      ...sanitizedRows.map((row: Record<string, string>) => [
        row.requestId,
        row.city,
        row.clientName,
        row.date,
        row.serviceType,
        row.vehicleNumber,
        row.vehicleAvailabilityLocation,
        row.ltpocName,
        row.ltpocPhone,
      ].map(csvEscape).join(',')),
    ];
    const csvBuffer = Buffer.from(csvLines.join('\n'), 'utf-8');

    const previewRows = sanitizedRows
      .slice(0, 100)
      .map((row: Record<string, string>) => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">${row.requestId}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.city}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.clientName}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.date}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.serviceType}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.vehicleNumber}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.vehicleAvailabilityLocation}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.ltpocName || 'N/A'}</td>
          <td style="padding:8px;border:1px solid #ddd;">${row.ltpocPhone || 'N/A'}</td>
        </tr>
      `)
      .join('');

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false',
      },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: [...vendorEmails].join(','),
      subject: 'Consolidated GPS Service Requests',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto;">
          <h2>Consolidated GPS Service Requests</h2>
          <p>Dear ${vendorName} Team,</p>
          <p>Attached CSV contains vehicle-level consolidated rows for processing.</p>
          <p>Total rows: ${sanitizedRows.length}</p>
          <table style="width:100%;border-collapse:collapse;margin-top:10px;">
            <thead>
              <tr style="background:#f3f3f3;">
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Request ID</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">City</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Client</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Date</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Service Type</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Vehicle Number</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Availability Location</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">LTPOC Name</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">LTPOC Phone</th>
              </tr>
            </thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
      `,
      attachments: [{
        filename: `${vendorKey || 'vendor'}_consolidated_${new Date().toISOString().slice(0, 10)}.csv`,
        content: csvBuffer,
      }],
    });

    const updatedItems: Array<{ requestId: string; numericId: number; status: string }> = [];
    const failedRequestIds: string[] = [];

    for (const anyId of deduped) {
      const found = await resolveRequestByIdentifier(anyId);
      if (!found) {
        failedRequestIds.push(anyId);
        continue;
      }

      const previousStatus = found.status;
      const updated = await prisma.request.update({
        where: { id: found.id },
        data: {
          vendorName,
          vendorStatus: 'NOTIFIED',
          vendorNotified: true,
          vendorBulkMailSentAt: new Date(),
          status: found.status === 'HALTED' ? found.status : 'VENDOR_COORDINATION',
        },
      });

      await prisma.requestVehicle.updateMany({
        where: {
          requestId: found.id,
          paymentApproved: true,
          paymentRejected: false,
        },
        data: {
          vendorNotified: true,
          vendorName,
        },
      });

      await prisma.notification.create({
        data: {
          requestId: found.id,
          recipientEmail: [...vendorEmails].join(','),
          recipientRole: 'VENDOR',
          notificationType: 'VENDOR_BULK',
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      await addHistory(found.id, actor, 'VENDOR_NOTIFY', previousStatus || null, updated.status || null, `Vendor notified: ${vendorName}`);
      updatedItems.push({ requestId: formatRequestId(found.id), numericId: found.id, status: updated.status });
    }

    const successfulRequestIds = updatedItems.map((item) => String(item.numericId));

    return res.json({
      success: true,
      vendorName,
      processed: updatedItems.length,
      count: sanitizedRows.length,
      requestIds: successfulRequestIds,
      formattedRequestIds: updatedItems.map((item) => item.requestId),
      failedRequestIds,
      sentTo: [...vendorEmails],
      requests: updatedItems,
    });
  } catch (error) {
    const message = (error as Error).message || 'Failed to send vendor bulk notification';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to send vendor bulk notification', details: message });
  }
});

app.post('/finalizeVendorNotifications', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['PAYMENT', 'ADMIN', 'VENDOR']);

    const items: Array<{ requestId?: unknown }> = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ error: 'items array is required.' });
    }

    let completed = 0;
    for (const item of items) {
      const anyId = String(item?.requestId || '').trim();
      if (!anyId) {
        continue;
      }
      const found = await resolveRequestByIdentifier(anyId);
      if (!found) {
        continue;
      }

      const previousStatus = found.status;
      await prisma.request.update({
        where: { id: found.id },
        data: {
          status: 'COMPLETED',
          vendorStatus: 'APPROVED',
          vendorApprovedAt: new Date(),
          foBulkNotifyEnabled: true,
        },
      });

      await addHistory(found.id, actor, 'VENDOR_FINALIZE', previousStatus || null, 'COMPLETED', 'Vendor notifications finalized');
      completed += 1;
    }

    return res.json({ success: true, completed });
  } catch (error) {
    const message = (error as Error).message || 'Failed to finalize vendor notifications';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to finalize vendor notifications', details: message });
  }
});

app.post('/sendFoBulkNotification', verifyFirebaseToken, checkCompanyDomain, async (req: Request, res: Response) => {
  try {
    const actor = await getOrCreateUserFromToken(req as AuthedRequest);
    ensureRole(actor.role, ['PAYMENT', 'RH', 'ADMIN', 'VENDOR']);

    const requestIds: string[] = Array.isArray(req.body?.requestIds)
      ? req.body.requestIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    if (requestIds.length === 0) {
      return res.status(400).json({ error: 'requestIds are required.' });
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || 'no-reply@gps-automation.local';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return res.status(500).json({
        error: 'Failed to send FO bulk notification',
        details: 'SMTP is not configured on API server.',
      });
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false',
      },
    });

    const normalizeRequestIdKey = (value: unknown) => {
      const raw = String(value || '').trim().toUpperCase();
      if (!raw) {
        return '';
      }

      const reqMatch = raw.match(/^REQ[-_\s]?0*(\d+)$/);
      if (reqMatch?.[1]) {
        return String(Number(reqMatch[1]));
      }

      if (/^\d+$/.test(raw)) {
        return String(Number(raw));
      }

      return raw.replace(/[^A-Z0-9]/g, '');
    };

    type FoPayloadRow = {
      requestId: string;
      status: string;
      city: string;
      clientName: string;
      vendorName: string;
      vendorEmails: string;
      serviceType: string;
      serviceCost: string;
      vehicleNumber: string;
      vehicleAvailabilityLocation: string;
      vehicleAvailableTime: string;
      ltpocName: string;
      ltpocPhone: string;
      createdAt: string;
    };

    type FoRequestMeta = {
      id: number;
      numericId: string;
      formattedId: string;
      status: string;
      city: string;
      clientName: string;
      vendorName: string;
      vendorEmails: string[];
      foEmail: string;
    };

    const normalizeVendorKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const vendorUsers = await prisma.user.findMany({
      where: { role: 'VENDOR' },
      select: { email: true, name: true },
    });

    const resolveVendorEmailsForName = (vendorName: string): string[] => {
      const key = normalizeVendorKey(vendorName);
      if (!key) {
        return [];
      }

      const emails = new Set<string>();

      const envMapRaw = String(process.env.VENDOR_EMAILS || '').trim();
      if (envMapRaw) {
        envMapRaw
          .split(/[;,]/)
          .map((entry) => entry.trim())
          .filter(Boolean)
          .forEach((entry) => {
            const separator = entry.includes('=') ? '=' : entry.includes(':') ? ':' : '';
            if (!separator) {
              return;
            }

            const [rawVendor, rawEmail] = entry.split(separator);
            const parsedVendor = normalizeVendorKey(rawVendor || '');
            const parsedEmail = String(rawEmail || '').trim().toLowerCase();
            if (parsedVendor === key && parsedEmail.includes('@')) {
              emails.add(parsedEmail);
            }
          });
      }

      const envSpecificKey = `VENDOR_EMAIL_${String(vendorName || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      const envSpecificEmail = String((process.env as Record<string, string | undefined>)[envSpecificKey] || '').trim().toLowerCase();
      if (envSpecificEmail.includes('@')) {
        emails.add(envSpecificEmail);
      }

      for (const vendorUser of vendorUsers) {
        const userVendorKey = normalizeVendorKey(String(vendorUser.name || '').trim());
        const userEmail = String(vendorUser.email || '').trim().toLowerCase();
        if (userVendorKey === key && userEmail.includes('@')) {
          emails.add(userEmail);
        }
      }

      if (emails.size === 0) {
        if (key === 'fleetx') {
          emails.add('anupgogeri2@gmail.com');
        } else if (key === 'wheelseye') {
          emails.add('anupgogeri3@gmail.com');
        }
      }

      return [...emails];
    };

    const dedupedRequestIds = Array.from(new Set(requestIds));
    const requestMetaByKey = new Map<string, FoRequestMeta>();
    const failedRequestIds = new Set<string>();

    for (const anyId of dedupedRequestIds) {
      const found = await resolveRequestByIdentifier(String(anyId));
      if (!found) {
        failedRequestIds.add(String(anyId));
        continue;
      }

      const foEmail = String(found.assignedFoEmail || found.createdByEmail || '').trim().toLowerCase();
      if (!foEmail || !foEmail.includes('@')) {
        failedRequestIds.add(String(found.id));
        continue;
      }

      requestMetaByKey.set(normalizeRequestIdKey(found.id), {
        id: found.id,
        numericId: String(found.id),
        formattedId: formatRequestId(found.id),
        status: String(found.status || '').trim(),
        city: String(found.city || '').trim(),
        clientName: String(found.clientName || '').trim(),
        vendorName: String(found.vendorName || '').trim(),
        vendorEmails: resolveVendorEmailsForName(String(found.vendorName || '').trim()),
        foEmail,
      });
    }

    const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const sanitize = (value: unknown) => String(value ?? '').trim();
    const rowsByFoEmail = new Map<string, FoPayloadRow[]>();
    const requestIdsByFoEmail = new Map<string, Set<string>>();

    const addRowToFoGroup = (foEmail: string, row: FoPayloadRow, numericRequestId: string) => {
      const currentRows = rowsByFoEmail.get(foEmail) || [];
      currentRows.push(row);
      rowsByFoEmail.set(foEmail, currentRows);

      const requestSet = requestIdsByFoEmail.get(foEmail) || new Set<string>();
      requestSet.add(numericRequestId);
      requestIdsByFoEmail.set(foEmail, requestSet);
    };

    for (const rawRow of rawRows) {
      const rowSource = rawRow && typeof rawRow === 'object' ? (rawRow as Record<string, unknown>) : {};
      const payloadRequestId = sanitize(rowSource.requestId);
      const requestMeta = requestMetaByKey.get(normalizeRequestIdKey(payloadRequestId));
      if (!requestMeta) {
        continue;
      }

      addRowToFoGroup(
        requestMeta.foEmail,
        {
          requestId: requestMeta.formattedId,
          status: sanitize(rowSource.status) || requestMeta.status || 'N/A',
          city: sanitize(rowSource.city) || requestMeta.city,
          clientName: sanitize(rowSource.clientName) || requestMeta.clientName,
          vendorName: sanitize(rowSource.vendorName) || requestMeta.vendorName || 'N/A',
          vendorEmails: sanitize(rowSource.vendorEmail || rowSource.vendorEmails) || (requestMeta.vendorEmails.join(', ') || 'N/A'),
          serviceType: sanitize(rowSource.serviceType) || 'N/A',
          serviceCost: sanitize(rowSource.serviceCost) || 'N/A',
          vehicleNumber: sanitize(rowSource.vehicleNumber) || 'N/A',
          vehicleAvailabilityLocation: sanitize(rowSource.vehicleAvailabilityLocation),
          vehicleAvailableTime: sanitize(rowSource.vehicleAvailableTime),
          ltpocName: sanitize(rowSource.ltpocName ?? rowSource.lptocName),
          ltpocPhone: sanitize(rowSource.ltpocPhone ?? rowSource.lptocPhone),
          createdAt: sanitize(rowSource.createdAt),
        },
        requestMeta.numericId,
      );
    }

    for (const requestMeta of requestMetaByKey.values()) {
      const hasRows = (rowsByFoEmail.get(requestMeta.foEmail) || []).some(
        (row) => normalizeRequestIdKey(row.requestId) === requestMeta.numericId,
      );
      if (hasRows) {
        continue;
      }

      addRowToFoGroup(
        requestMeta.foEmail,
        {
          requestId: requestMeta.formattedId,
          status: requestMeta.status || 'N/A',
          city: requestMeta.city,
          clientName: requestMeta.clientName,
          vendorName: requestMeta.vendorName || 'N/A',
          vendorEmails: requestMeta.vendorEmails.join(', ') || 'N/A',
          serviceType: requestMeta.vendorName || 'N/A',
          serviceCost: 'N/A',
          vehicleNumber: 'N/A',
          vehicleAvailabilityLocation: '',
          vehicleAvailableTime: '',
          ltpocName: '',
          ltpocPhone: '',
          createdAt: '',
        },
        requestMeta.numericId,
      );
    }

    if (rowsByFoEmail.size === 0) {
      return res.status(400).json({
        error: 'Failed to send FO bulk notification',
        details: 'No FO email found for selected requests.',
      });
    }

    let updatedCount = 0;
    let rowCount = 0;
    const successfulRequestIds = new Set<string>();
    const recipientEmails = new Set<string>();

    for (const [foEmail, rows] of rowsByFoEmail.entries()) {
      recipientEmails.add(foEmail);
      rowCount += rows.length;
      const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const csvLines = [
        [
          'Request ID',
          'Status',
          'City',
          'Client',
          'Vendor Name',
          'Vendor Email(s)',
          'Service Type',
          'Service Cost',
          'Vehicle Number',
          'Availability Location',
          'Available Time',
          'LTPOC Name',
          'LTPOC Phone',
          'Created At',
        ].map(csvEscape).join(','),
        ...rows.map((row) => [
          row.requestId,
          row.status,
          row.city,
          row.clientName,
          row.vendorName,
          row.vendorEmails,
          row.serviceType,
          row.serviceCost,
          row.vehicleNumber,
          row.vehicleAvailabilityLocation,
          row.vehicleAvailableTime,
          row.ltpocName,
          row.ltpocPhone,
          row.createdAt,
        ].map(csvEscape).join(',')),
      ];
      const csvBuffer = Buffer.from(csvLines.join('\n'), 'utf-8');

      const tableRows = rows
        .map((row) => `
          <tr>
            <td style="padding:8px;border:1px solid #ddd;">${row.requestId}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.status || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.city}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.clientName}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.vendorName || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.vendorEmails || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.serviceType || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.vehicleNumber || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.vehicleAvailabilityLocation || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.vehicleAvailableTime || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.ltpocName || 'N/A'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${row.ltpocPhone || 'N/A'}</td>
          </tr>
        `)
        .join('');

      await transporter.sendMail({
        from: smtpFrom,
        to: foEmail,
        subject: 'GPS Bulk Request Update',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto;">
            <h2>Bulk Request Notification</h2>
            <p>The following request(s) have been updated and require FO visibility:</p>
            <p>For further information, use the Vendor Name and Vendor Email(s) columns below.</p>
            <table style="width:100%;border-collapse:collapse;margin-top:10px;">
              <thead>
                <tr style="background:#f3f3f3;">
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Request ID</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Status</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">City</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Client</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Vendor Name</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Vendor Email(s)</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Service Type</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Vehicle Number</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Availability Location</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">Available Time</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">LTPOC Name</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left;">LTPOC Phone</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `,
        attachments: [{
          filename: `fo_bulk_${new Date().toISOString().slice(0, 10)}.csv`,
          content: csvBuffer,
        }],
      });

      const requestIdsForFo = requestIdsByFoEmail.get(foEmail) || new Set<string>();
      for (const requestId of requestIdsForFo.values()) {
        const requestMeta = requestMetaByKey.get(normalizeRequestIdKey(requestId));
        if (!requestMeta) {
          failedRequestIds.add(requestId);
          continue;
        }

        await prisma.request.update({
          where: { id: requestMeta.id },
          data: {
            foNotified: true,
            foNotifiedAt: new Date(),
          },
        });

        await prisma.notification.create({
          data: {
            requestId: requestMeta.id,
            recipientEmail: foEmail,
            recipientRole: 'FO',
            notificationType: 'FO_BULK',
            status: 'SENT',
            sentAt: new Date(),
          },
        });

        await addHistory(
          requestMeta.id,
          actor,
          'FO_BULK_NOTIFY',
          requestMeta.status || null,
          requestMeta.status || null,
          `FO notified for bulk request (${foEmail})`,
        );

        successfulRequestIds.add(requestMeta.numericId);
        failedRequestIds.delete(requestMeta.numericId);
        updatedCount += 1;
      }
    }

    return res.json({
      success: true,
      updated: updatedCount,
      rowCount,
      groupCount: rowsByFoEmail.size,
      requestIds: [...successfulRequestIds],
      failedRequestIds: [...failedRequestIds],
      sentTo: [...recipientEmails],
    });
  } catch (error) {
    const message = (error as Error).message || 'Failed to send FO bulk notification';
    if (message.startsWith('FORBIDDEN_')) {
      return res.status(403).json({ error: 'Forbidden', details: message });
    }
    return res.status(500).json({ error: 'Failed to send FO bulk notification', details: message });
  }
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// SERVER STARTUP
// ============================================================

const DEFAULT_PORT = 3002;
const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

async function startServer() {
  try {
    // Test database connection in production. In local/dev environments, keep the
    // API alive so the frontend receives HTTP errors instead of connection refusals.
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connected');
    } catch (error) {
      if (isProduction) {
        throw error;
      }

      console.warn('⚠️ Database is not reachable yet; starting API in degraded mode.');
      console.warn(error);
    }

    // Firebase initialized
    console.log('✅ Firebase Admin SDK initialized');

    // Company domain configured
    console.log(`✅ Company email domain: @${allowedDomain}`);

    app.listen(PORT, () => {
      console.log(`\n🚀 GPS API Server running on http://localhost:${PORT}`);
      console.log(`\n📝 Endpoints:`);
      console.log(`   GET  /health - Health check`);
      console.log(`   GET  /health/db - Database health check`);
      console.log(`   GET  /test/request-id - Request ID format examples`);
      console.log(`   GET  /users/me - Get current user profile (auth required)`);
      console.log(`   GET  /requests - List requests (auth required)`);
      console.log(`   GET  /requests/:requestId - Get request details (auth required)`);
      console.log(`\n🔐 Protected endpoints require Firebase token + company email (@${allowedDomain})\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n📌 Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
