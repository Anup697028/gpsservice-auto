import { onRequest } from 'firebase-functions/v2/https';
import nodemailer from 'nodemailer';
import cors from 'cors';
import admin from 'firebase-admin';

const corsHandler = cors({ origin: true });

if (!admin.apps.length) {
  admin.initializeApp();
}

const firestore = admin.firestore();

type OtpPayload = {
  email: string;
  otp: string;
};

type LTPOCDetail = {
  vehicleNumber: string;
  ltpocName: string;
  ltpocPhone: string;
  ltpocEmail?: string;
  lpoNumber?: string;
  lpoDate?: string;
  lpoReferenceId?: string;
  lpoAdditional?: string;
};

type VendorNotificationPayload = {
  requestId: string;
  vendorName: string;
  clientName?: string | null;
  city?: string | null;
  serviceType?: string | null;
  vehicleAvailabilityLocation?: string | null;
  vehicleAvailableTime?: string | null;
  vehicles?: Array<{ vehicleNumber: string; isNewTrip?: boolean }>;
  ltpocDetails?: LTPOCDetail[];
  vehicleCount?: number;
  isBulkRequest?: boolean;
};

type NotifyFOPayload = {
  vehicleId: string;
  installationDate?: string;
  requestId?: string;
  vendorName?: string;
  clientName?: string | null;
  city?: string | null;
  serviceType?: string | null;
  vehicleAvailabilityLocation?: string | null;
  vehicleAvailableTime?: string | null;
  ltpocName?: string | null;
  ltpocPhone?: string | null;
  ltpocEmail?: string | null;
};

type VendorBulkRow = {
  requestId: string;
  city?: string | null;
  clientName?: string | null;
  date?: string | null;
  serviceType?: string | null;
  vehicleNumber?: string | null;
  vehicleAvailabilityLocation?: string | null;
  vehicleAvailableTime?: string | null;
  ltpocName?: string | null;
  ltpocPhone?: string | null;
  ltpocEmail?: string | null;
  lpoAdditional?: string | null;
};

type VendorBulkNotificationPayload = {
  vendorName: string;
  requestIds?: string[];
  rows: VendorBulkRow[];
};

type FoBulkRow = {
  requestId: string;
  status: string;
  city: string;
  clientName: string;
  serviceType: string;
  serviceCost: number | '';
  vehicleNumber: string;
  vehicleAvailabilityLocation: string;
  vehicleAvailableTime: string;
  ltpocName: string;
  ltpocPhone: string;
  lpoAdditional: string;
  createdAt: string;
};

type FoBulkNotificationPayload = {
  requestIds: string[];
  foEmail?: string;
  foName?: string;
  rows: FoBulkRow[];
};

const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials are not configured.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
};

// Safe value renderer - returns empty string for null, undefined, empty, or "NA"
function safeValue(value: any): string {
  if (value === null || value === undefined || value === '' || value === 'NA' || value === '-') {
    return '';
  }
  return String(value).trim();
}

const toBooleanFlag = (value: unknown): boolean => {
  if (value === true) {
    return true;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return false;
};

const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const buildCsvBuffer = (headers: string[], rows: Array<Array<unknown>>) => {
  const csv = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(',')),
  ].join('\n');

  return Buffer.from(csv, 'utf-8');
};

// Validate that an email is not obviously a fake test address
const isValidRealEmail = (email: string): boolean => {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  // Reject obviously fake domains (test, example, company, dev, test.com, etc.)
  const fakeDomains = ['@company.com', '@example.com', '@test.com', '@test.org', '@fake.', '@dev.', 'fo1@', 'fo2@', 'fo3@'];
  return !fakeDomains.some(fake => normalized.includes(fake));
};

const vendorEmailMap: Record<string, string | undefined> = {
  FleetX: process.env.VENDOR_FLEETX || 'your-fleetx-email@company.com',
  WheelsEye: process.env.VENDOR_WHEELSEYE || 'your-wheelseye-email@company.com',
};

// Test mode is disabled in production. Emails are always sent to real addresses.
// If you need test emails, set TEST_NOTIFICATION_EMAIL env var, but otherwise leave empty/unset
const TEST_NOTIFICATION_EMAIL = process.env.TEST_NOTIFICATION_EMAIL;

const resolveRecipientEmail = (actualEmail: string) => {
  if (TEST_NOTIFICATION_EMAIL) {
    console.warn(`⚠️ TEST MODE ACTIVE: Routing email to ${TEST_NOTIFICATION_EMAIL} instead of ${actualEmail}`);
    return TEST_NOTIFICATION_EMAIL;
  }
  return actualEmail;
};

const TERMINAL_NOTIFY_STATUSES = new Set(['REJECTED', 'HALTED', 'CANCELLED']);
const FO_NOTIFY_LOCK_TTL_MS = 15 * 60 * 1000;

type FoNotifyLock = {
  operationId: string;
  lockedAt: admin.firestore.FieldValue;
  lockedBy: string;
};

const normalizeRole = (role: unknown) => safeValue(role).toUpperCase().replace(/[\s-]+/g, '_');

const isVendorCoordinatorRole = (role: unknown) => {
  const normalized = normalizeRole(role);
  return normalized === 'VENDOR' || normalized === 'VENDOR_COORDINATOR';
};

const isStaleLock = (lockValue: unknown): boolean => {
  if (!lockValue || typeof lockValue !== 'object') {
    return false;
  }

  const lockRecord = lockValue as Record<string, unknown>;
  const lockedAt = lockRecord.lockedAt;
  if (!(lockedAt instanceof admin.firestore.Timestamp)) {
    return false;
  }

  return Date.now() - lockedAt.toDate().getTime() > FO_NOTIFY_LOCK_TTL_MS;
};

const getBearerToken = (authorizationHeader: string | undefined) => {
  const headerValue = safeValue(authorizationHeader);
  if (!headerValue || !headerValue.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return safeValue(headerValue.slice(7));
};

const requireVendorCoordinator = async (req: { headers?: Record<string, unknown> }) => {
  const token = getBearerToken(req.headers?.authorization as string | undefined);
  if (!token) {
    throw new Error('UNAUTHORIZED_MISSING_TOKEN');
  }

  const decoded = await admin.auth().verifyIdToken(token);
  const callerUid = safeValue(decoded.uid);
  if (!callerUid) {
    throw new Error('UNAUTHORIZED_INVALID_TOKEN');
  }

  const callerUserDoc = await firestore.collection('users').doc(callerUid).get();
  if (!callerUserDoc.exists) {
    throw new Error('UNAUTHORIZED_USER_NOT_FOUND');
  }

  const callerRole = (callerUserDoc.data() as Record<string, unknown> | undefined)?.role;
  if (!isVendorCoordinatorRole(callerRole)) {
    throw new Error('FORBIDDEN_VENDOR_COORDINATOR_ONLY');
  }

  return callerUid;
};

const resolveAssignedFo = async (requestData: Record<string, unknown>) => {
  const assignedFoId =
    safeValue(requestData.assignedFoId) ||
    safeValue(requestData.foId) ||
    safeValue(requestData.createdBy);

  const directFoEmail = safeValue(requestData.foEmail);
  const directFoName = safeValue(requestData.foName);

  if (assignedFoId) {
    const userDoc = await firestore.collection('users').doc(assignedFoId).get();
    if (!userDoc.exists) {
      throw new Error(`Assigned FO user not found: ${assignedFoId}`);
    }

    const userData = userDoc.data() as Record<string, unknown>;
    const userEmail = safeValue(userData.email);
    const userName = safeValue(userData.name) || safeValue(userData.userName) || 'Field Operator';
    if (!userEmail) {
      throw new Error(`FO email not available for user: ${assignedFoId}`);
    }

    return {
      foGroupKey: `uid:${assignedFoId}`,
      foEmail: userEmail,
      foName: userName,
    };
  }

  if (directFoEmail) {
    return {
      foGroupKey: `mail:${directFoEmail.toLowerCase()}`,
      foEmail: directFoEmail,
      foName: directFoName || 'Field Operator',
    };
  }

  throw new Error('Unable to resolve assigned FO for request.');
};

export const sendOTP = onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        res.status(400).json({ error: 'Email and OTP are required.' });
        return;
      }

      const transporter = getTransporter();
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@gps-automation.local',
        to: email,
        subject: 'Your verification code',
        text: `Your OTP is ${otp}. It expires in 10 minutes.`,
      });

      res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to send OTP.' });
    }
  });
});

export const sendVendorNotification = onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    try {
      const { requestId, vendorName, clientName, city, vehicles, ltpocDetails, serviceType, vehicleAvailabilityLocation, vehicleAvailableTime } = req.body as VendorNotificationPayload;

      // Validation
      if (!requestId || !vendorName) {
        res.status(400).json({ error: 'Request ID and vendor name are required.' });
        return;
      }

      const vendorEmail = vendorEmailMap[vendorName];
      if (!vendorEmail) {
        res.status(400).json({ error: 'Vendor email not configured.' });
        return;
      }

      const recipientEmail = resolveRecipientEmail(vendorEmail);

      const requestRef = firestore.collection('requests').doc(requestId);
      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) {
        res.status(404).json({ error: `Request not found: ${requestId}.` });
        return;
      }

      const requestData = requestDoc.data() as Record<string, any>;
      if (requestData?.vendorName || requestData?.notificationTimestamp) {
        res.status(409).json({ error: 'Vendor already notified for this request.' });
        return;
      }

      if (
        requestData?.status &&
        requestData.status !== 'VENDOR_COORDINATION' &&
        requestData.status !== 'PAYMENT_APPROVED'
      ) {
        res.status(409).json({ error: 'Request is not ready for vendor notification.' });
        return;
      }

      // Build Installation Status table with 5 columns
      const installationRows = (vehicles ?? [])
        .map((vehicle: { vehicleNumber: string; isNewTrip?: boolean }) => {
          const ltpoc = (ltpocDetails ?? []).find((d) => d.vehicleNumber === vehicle.vehicleNumber);
          
          // Skip if LTPOC data missing (ensures no "NA" or "-" values)
          if (!ltpoc || !ltpoc.ltpocName || !ltpoc.ltpocPhone) {
            return null;
          }

          const installationDate = new Date().toLocaleDateString();

          return `
            <tr>
              <td style="padding: 12px; border: 1px solid #dee2e6; font-weight: 500;">${vehicle.vehicleNumber}</td>
              <td style="padding: 12px; border: 1px solid #dee2e6;">${vendorName}</td>
              <td style="padding: 12px; border: 1px solid #dee2e6;">${ltpoc.ltpocName}</td>
              <td style="padding: 12px; border: 1px solid #dee2e6;">${ltpoc.ltpocPhone}</td>
              <td style="padding: 12px; border: 1px solid #dee2e6;">${installationDate}</td>
            </tr>
          `;
        })
        .filter((row) => row !== null)
        .join('');

      const installationStatusTable = installationRows
        ? `
            <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
              <tr style="background: #667eea; color: white;">
                <th colspan="5" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">INSTALLATION STATUS</th>
              </tr>
              <tr style="background: #f0f2ff;">
                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #d6d9ff; font-weight: 600; font-size: 13px;">Vehicle Number</th>
                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #d6d9ff; font-weight: 600; font-size: 13px;">Vendor Name</th>
                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #d6d9ff; font-weight: 600; font-size: 13px;">LTPOC Name</th>
                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #d6d9ff; font-weight: 600; font-size: 13px;">LTPOC Phone</th>
                <th style="padding: 12px; text-align: left; border-bottom: 1px solid #d6d9ff; font-weight: 600; font-size: 13px;">Installation Date</th>
              </tr>
              ${installationRows}
            </table>
          `
        : '';

      // Build Request Details table (conditional rendering - no NA values)
      let requestDetailsRows = '';
      if (requestId) {
        requestDetailsRows += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600; width: 35%;">Request ID</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${requestId}</strong></td>
          </tr>
        `;
      }
      if (serviceType) {
        requestDetailsRows += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Service Type</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><span style="background: linear-gradient(135deg, #1f6f78 0%, #15545a 100%); color: white; padding: 8px 16px; border-radius: 20px; font-weight: 700; text-transform: uppercase; font-size: 14px; letter-spacing: 0.05em; display: inline-block;">${serviceType}</span></td>
          </tr>
        `;
      }
      if (city) {
        requestDetailsRows += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">City</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${city}</td>
          </tr>
        `;
      }
      if (clientName) {
        requestDetailsRows += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Client</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${clientName}</td>
          </tr>
        `;
      }
      if (vehicleAvailabilityLocation) {
        requestDetailsRows += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vehicle Availability Location</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${vehicleAvailabilityLocation}</td>
          </tr>
        `;
      }
      if (vehicleAvailableTime) {
        requestDetailsRows += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vehicle Available Time</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${vehicleAvailableTime}</td>
          </tr>
        `;
      }

      const requestDetailsTable = `
        <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
          <tr style="background: #1f6f78; color: white;">
            <th colspan="2" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">REQUEST DETAILS</th>
          </tr>
          ${requestDetailsRows}
        </table>
      `;

      const notifyBaseUrl = process.env.NOTIFY_FO_URL || 'https://notifyfo-7lmuix7vmq-uc.a.run.app';

      // Build LPO Details table (if any vehicle has LPO data)
      let lpoDetailsTable = '';
      const vehiclesWithLpo = (ltpocDetails ?? []).filter((ltpoc) => ltpoc.lpoAdditional);

      if (vehiclesWithLpo.length > 0) {
        const lpoRows = vehiclesWithLpo
          .map((ltpoc) => `
            <tr>
              <td style="padding: 12px; border: 1px solid #dee2e6;">${ltpoc.vehicleNumber || ''}</td>
              <td style="padding: 12px; border: 1px solid #dee2e6;">${ltpoc.lpoAdditional || '-'}</td>
            </tr>
          `)
          .join('');

        lpoDetailsTable = `
          <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
            <tr style="background: #667eea; color: white;">
              <th colspan="2" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">LPO DETAILS</th>
            </tr>
            <tr style="background: #f0f2ff;">
              <th style="padding: 12px; text-align: left; border-bottom: 1px solid #d6d9ff; font-weight: 600; font-size: 13px;">Vehicle Number</th>
              <th style="padding: 12px; text-align: left; border-bottom: 1px solid #d6d9ff; font-weight: 600; font-size: 13px;">LPO Additional</th>
            </tr>
            ${lpoRows}
          </table>
        `;
      }

      // Build CSV for vendor notification
      const csvHeaders = [
        'Request ID',
        'City',
        'Client Name',
        'Service Type',
        'Vehicle Number',
        'Location',
        'Available Time',
        'LTPOC Name',
        'LTPOC Phone',
        'LTPOC Email',
        'LPO Additional',
      ];

      const csvRows = (ltpocDetails ?? []).map((ltpoc) => [
        requestId || '',
        city || '',
        clientName || '',
        serviceType || '',
        ltpoc.vehicleNumber || '',
        vehicleAvailabilityLocation || '',
        vehicleAvailableTime || '',
        ltpoc.ltpocName || '',
        ltpoc.ltpocPhone || '',
        ltpoc.ltpocEmail || '',
        ltpoc.lpoAdditional || '',
      ]);

      const csvBuffer = csvRows.length > 0 ? buildCsvBuffer(csvHeaders, csvRows) : null;

      // Build Notify FO buttons
      let notifyButtons = '';
      if (vehicles && vehicles.length > 0) {
        notifyButtons = vehicles
          .map((v: any) => {
            const matchingLtpoc = (ltpocDetails ?? []).find((d) => d.vehicleNumber === v.vehicleNumber);
            const installationDate = new Date().toLocaleDateString();

            const notifyParams = new URLSearchParams({
              vehicleId: v.vehicleNumber || '',
              installationDate,
              requestId: requestId || '',
              vendorName: vendorName || '',
              clientName: clientName || '',
              city: city || '',
              serviceType: serviceType || '',
              vehicleAvailabilityLocation: vehicleAvailabilityLocation || '',
              vehicleAvailableTime: vehicleAvailableTime || '',
              ltpocName: matchingLtpoc?.ltpocName || '',
              ltpocPhone: matchingLtpoc?.ltpocPhone || '',
              ltpocEmail: matchingLtpoc?.ltpocEmail || '',
            }).toString();

            const notifyUrl = `${notifyBaseUrl}?${notifyParams}`;

            return `
            <a href="${notifyUrl}" title="Vehicle ${v.vehicleNumber || ''}" style="display: inline-block; margin: 10px 5px 0; padding: 12px 28px; background: linear-gradient(135deg, #28a745 0%, #20873a 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);">
              Notify FO
            </a>
          `;
          })
          .join('');
      }

      const transporter = getTransporter();
      const mailOptions: any = {
        from: process.env.SMTP_FROM || 'no-reply@gps-automation.local',
        to: recipientEmail,
        subject: `GPS Installation Service Request - ${requestId}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #1f6f78 0%, #15545a 100%); padding: 30px; text-align: center;">
              <h2 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.02em;">GPS Installation Request</h2>
            </div>
            
            <div style="padding: 40px; background: #fafbfc;">
              <p style="font-size: 16px; color: #333; margin-bottom: 30px;">Dear <strong>${vendorName}</strong> Team,</p>
              
              ${requestDetailsTable}

              ${installationStatusTable}

              ${lpoDetailsTable}

              <div style="margin: 20px 0; text-align: center;">
                ${notifyButtons}
              </div>

              <div style="margin: 30px 0; padding: 20px; background: #fff3cd; border-left: 5px solid #ffc107; border-radius: 4px;">
                <p style="margin: 0; color: #856404; font-size: 14px;"><strong>⚠️ Action Required:</strong> Please acknowledge receipt and confirm service availability. Detailed information is attached as CSV.</p>
              </div>
            </div>
            
            <div style="padding: 20px; background: #f8f9fa; color: #6c757d; font-size: 12px; text-align: center; border-top: 1px solid #dee2e6;">
              <p style="margin: 0;">GPS Installation Automation System</p>
            </div>
          </div>
        `,
        text: `GPS Installation Request - ${requestId}\n\nDear ${vendorName} Team,\n\nPlease acknowledge receipt and confirm service availability for the attached request. Full details are in the attached CSV file.\n\nGPS Installation Automation System`,
      };

      if (csvBuffer) {
        mailOptions.attachments = [
          {
            filename: `${vendorName.toLowerCase()}_request_${requestId}_${new Date().toISOString().slice(0, 10)}.csv`,
            content: csvBuffer,
          },
        ];
      }

      await transporter.sendMail(mailOptions);

      res.status(200).json({ success: true, message: 'Vendor notification sent.' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to send vendor notification.' });
    }
  });
});

export const sendVendorBulkNotification = onRequest({ invoker: 'public' }, (req, res) => {
  return corsHandler(req, res, async () => {
    try {
      // Consolidated Vendor Flow:
      // 1) Receive flattened vehicle-level rows from selected requests
      // 2) Reject already vendor-notified requests
      // 3) Send exactly one email per vendor group with CSV attachment
      const { vendorName, rows, requestIds } = req.body as VendorBulkNotificationPayload;

      if (!vendorName || !rows || rows.length === 0) {
        res.status(400).json({ error: 'vendorName and non-empty rows are required.' });
        return;
      }

      const vendorEmail = vendorEmailMap[vendorName];
      if (!vendorEmail) {
        res.status(400).json({ error: 'Vendor email not configured.' });
        return;
      }

      const recipientEmail = resolveRecipientEmail(vendorEmail);

      const normalizeVendorName = (value: unknown) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'fleetx') return 'FleetX';
        if (normalized === 'wheelseye') return 'WheelsEye';
        return '';
      };

      const payloadRowMap = new Map<string, VendorBulkRow>();
      const payloadRequestFallbackMap = new Map<string, VendorBulkRow>();
      rows.forEach((row) => {
        const requestId = safeValue(row.requestId);
        const vehicleNumber = safeValue(row.vehicleNumber);
        if (!requestId) {
          return;
        }
        payloadRowMap.set(`${requestId}::${vehicleNumber}`, row);
        if (!payloadRequestFallbackMap.has(requestId)) {
          payloadRequestFallbackMap.set(requestId, row);
        }
      });

      let sanitizedRows: Array<{
        requestId: string;
        city: string;
        clientName: string;
        date: string;
        serviceType: string;
        vehicleNumber: string;
        vehicleAvailabilityLocation: string;
        vehicleAvailableTime: string;
        ltpocName: string;
        ltpocPhone: string;
        ltpocEmail: string;
        lpoAdditional: string;
      }> = [];

      if (requestIds && requestIds.length > 0) {
        const requestRefs = requestIds.map((requestId) => firestore.collection('requests').doc(requestId));
        const requestDocs = await firestore.getAll(...requestRefs);

        sanitizedRows = requestDocs
          .filter((doc) => doc.exists)
          .flatMap((doc) => {
            const data = doc.data() as Record<string, any>;
            const baseDate = safeValue((data?.createdAt as any)?.toDate?.()?.toISOString?.() || data?.createdAt);

            const buildRow = (vehicle?: Record<string, any>) => {
              const hasVehiclePaymentSignals =
                vehicle && (vehicle.paymentApproved !== undefined || vehicle.paymentRejected !== undefined);

              if (vehicle) {
                if (toBooleanFlag(vehicle?.paymentRejected)) {
                  return null;
                }

                if (hasVehiclePaymentSignals && !toBooleanFlag(vehicle?.paymentApproved)) {
                  return null;
                }

                if (toBooleanFlag(vehicle?.vendorNotified)) {
                  return null;
                }
              }

              const serviceType = safeValue(vehicle?.serviceType || data?.serviceType);
              const normalized = normalizeVendorName(serviceType || data?.vendorName);
              if (normalized !== vendorName) {
                return null;
              }

              const vehicleNumber = safeValue(vehicle?.vehicleNumber);
              const payloadOverlay =
                payloadRowMap.get(`${doc.id}::${vehicleNumber}`) ||
                payloadRowMap.get(`${doc.id}::`) ||
                payloadRequestFallbackMap.get(doc.id);

              // Extract LTPOC details from vehicle or request ltpocDetails array
              const ltpocDetails = Array.isArray(data?.ltpocDetails) 
                ? data.ltpocDetails.find((ltpoc: any) => ltpoc?.vehicleNumber === vehicleNumber)
                : null;
              const ltpocFromVehicle = vehicle?.ltpocDetails?.[0] || vehicle;

              const resolvedServiceType =
                safeValue(payloadOverlay?.serviceType) ||
                safeValue(vehicle?.serviceType) ||
                safeValue(data?.serviceType);

              const resolvedVehicleNumber =
                safeValue(payloadOverlay?.vehicleNumber) ||
                vehicleNumber;

              return {
                requestId: doc.id,
                city: safeValue(payloadOverlay?.city) || safeValue(data?.city),
                clientName: safeValue(payloadOverlay?.clientName) || safeValue(data?.clientName),
                date: baseDate,
                serviceType: resolvedServiceType,
                vehicleNumber: resolvedVehicleNumber,
                vehicleAvailabilityLocation:
                  safeValue(payloadOverlay?.vehicleAvailabilityLocation) ||
                  safeValue(vehicle?.vehicleAvailabilityLocation || data?.vehicleAvailabilityLocation),
                vehicleAvailableTime:
                  safeValue(payloadOverlay?.vehicleAvailableTime) ||
                  safeValue(vehicle?.vehicleAvailableTime || data?.vehicleAvailableTime),
                ltpocName:
                  safeValue((payloadOverlay as any)?.ltpocName) ||
                  safeValue(ltpocFromVehicle?.ltpocName || ltpocDetails?.ltpocName),
                ltpocPhone:
                  safeValue((payloadOverlay as any)?.ltpocPhone) ||
                  safeValue(ltpocFromVehicle?.ltpocPhone || ltpocDetails?.ltpocPhone),
                ltpocEmail:
                  safeValue((payloadOverlay as any)?.ltpocEmail) ||
                  safeValue(ltpocFromVehicle?.ltpocEmail || ltpocDetails?.ltpocEmail),
                lpoAdditional: safeValue(payloadOverlay?.lpoAdditional || ltpocFromVehicle?.lpoAdditional || ltpocDetails?.lpoAdditional),
              };
            };

            const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];
            if (vehicles.length > 0) {
              return vehicles.map((vehicle) => buildRow(vehicle as Record<string, any>)).filter(Boolean) as Array<{
                requestId: string;
                city: string;
                clientName: string;
                date: string;
                serviceType: string;
                vehicleNumber: string;
                vehicleAvailabilityLocation: string;
                vehicleAvailableTime: string;
                ltpocName: string;
                ltpocPhone: string;
                ltpocEmail: string;
                lpoAdditional: string;
              }>;
            }

            const single = buildRow();
            return single ? [single] : [];
          });
      } else {
        sanitizedRows = rows
          .map((row) => ({
            requestId: safeValue(row.requestId),
            city: safeValue(row.city),
            clientName: safeValue(row.clientName),
            date: safeValue(row.date),
            serviceType: safeValue(row.serviceType),
            vehicleNumber: safeValue(row.vehicleNumber),
            vehicleAvailabilityLocation: safeValue(row.vehicleAvailabilityLocation),
            vehicleAvailableTime: safeValue(row.vehicleAvailableTime),
            ltpocName: safeValue((row as any).ltpocName),
            ltpocPhone: safeValue((row as any).ltpocPhone),
            ltpocEmail: safeValue((row as any).ltpocEmail),
            lpoAdditional: safeValue(row.lpoAdditional),
          }))
          .filter((row) => row.requestId);
      }

      if (sanitizedRows.length === 0) {
        res.status(200).json({ success: true, alreadySent: true, count: 0, requestIds: [] });
        return;
      }

      const sentRequestIds = [...new Set(sanitizedRows.map((row) => row.requestId).filter(Boolean))];

      const headers = [
        'Request ID',
        'City',
        'Client',
        'Date',
        'Service Type',
        'Vehicle Number',
        'Vehicle Availability Location',
        'Vehicle Available Time',
        'LTPOC Name',
        'LTPOC Phone',
        'LTPOC Email',
        'LPO Additional',
      ];

      const csvRows = sanitizedRows.map((row) => [
        row.requestId,
        row.city,
        row.clientName,
        row.date,
        row.serviceType,
        row.vehicleNumber,
        row.vehicleAvailabilityLocation,
        row.vehicleAvailableTime,
        row.ltpocName,
        row.ltpocPhone,
        row.ltpocEmail,
        row.lpoAdditional,
      ]);

      const csvBuffer = buildCsvBuffer(headers, csvRows);

      const tableRows = sanitizedRows
        .slice(0, 100)
        .map(
          (row) => `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.requestId}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.city}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.clientName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.serviceType}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.vehicleNumber}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.vehicleAvailabilityLocation}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.ltpocName}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.ltpocPhone}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${row.lpoAdditional}</td>
            </tr>
          `
        )
        .join('');

      const transporter = getTransporter();
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@gps-automation.local',
        to: recipientEmail,
        subject: 'Consolidated GPS Service Requests',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto;">
            <h2>Bulk GPS Service Requests</h2>
            <p>Dear ${vendorName} Team,</p>
            <p>Please find the consolidated service-level request data attached as CSV.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
              <thead>
                <tr style="background: #f3f3f3;">
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Request ID</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">City</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Client</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Service Type</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Vehicle Number</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Location</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">LTPOC Name</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">LTPOC Phone</th>
                  <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">LPO Additional</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
            <p style="margin-top: 16px; color: #666;">Rows in email are capped for readability. Full data is in the attached CSV.</p>
          </div>
        `,
        text: `Bulk GPS service requests for ${vendorName}. Please refer to attached CSV for complete service-level details.`,
        attachments: [
          {
            filename: `${vendorName.toLowerCase()}_bulk_requests_${new Date().toISOString().slice(0, 10)}.csv`,
            content: csvBuffer,
          },
        ],
      });

      if (sentRequestIds.length > 0) {
        const postSendBatch = firestore.batch();
        sentRequestIds.forEach((requestId) => {
          postSendBatch.update(firestore.collection('requests').doc(requestId), {
            vendorBulkMailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            vendorBulkMailSentByFunction: true,
          });
        });
        await postSendBatch.commit();
      }

      res.status(200).json({ success: true, count: sanitizedRows.length, requestIds: sentRequestIds });
    } catch (error) {
      res.status(500).json({ error: 'Failed to send vendor bulk notification.' });
    }
  });
});

export const sendFoBulkNotification = onRequest({ invoker: 'public' }, (req, res) => {
  return corsHandler(req, res, async () => {
    try {
      const callerUid = await requireVendorCoordinator(req as { headers?: Record<string, unknown> });
      const { requestIds, rows } = req.body as FoBulkNotificationPayload;

      if (!requestIds || requestIds.length === 0 || !rows || rows.length === 0) {
        res.status(400).json({ error: 'requestIds and non-empty rows are required.' });
        return;
      }
      const uniqueRequestIds = [...new Set(requestIds.map((requestId) => safeValue(requestId)).filter(Boolean))];
      if (uniqueRequestIds.length === 0) {
        res.status(400).json({ error: 'No valid requestIds were provided.' });
        return;
      }

      const operationId = `fo_notify_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const selectedRefs = uniqueRequestIds.map((requestId) => firestore.collection('requests').doc(requestId));
      const lockPayload: FoNotifyLock = {
        operationId,
        lockedAt: admin.firestore.FieldValue.serverTimestamp(),
        lockedBy: callerUid,
      };

      const lockedRequestData = new Map<string, Record<string, unknown>>();

      await firestore.runTransaction(async (tx) => {
        const snapshots = await Promise.all(selectedRefs.map((ref) => tx.get(ref)));

        snapshots.forEach((snapshot) => {
          if (!snapshot.exists) {
            return;
          }

          const requestData = (snapshot.data() ?? {}) as Record<string, unknown>;
          const status = safeValue(requestData.status).toUpperCase();
          const alreadyNotified =
            toBooleanFlag(requestData.foNotified) ||
            Boolean(requestData.foBulkNotifiedAt) ||
            Boolean(requestData.foBulkNotificationSentAt);
          const lockedByAnotherActiveOp = Boolean(
            requestData.foNotificationLock && !isStaleLock(requestData.foNotificationLock)
          );

          if (alreadyNotified || TERMINAL_NOTIFY_STATUSES.has(status) || lockedByAnotherActiveOp) {
            return;
          }

          tx.update(snapshot.ref, {
            foNotificationLock: lockPayload,
          });
          lockedRequestData.set(snapshot.id, requestData);
        });
      });

      if (lockedRequestData.size === 0) {
        res.status(200).json({ success: true, alreadySent: true, rowCount: 0, groupCount: 0 });
        return;
      }

      const rowsByRequestId = new Map<string, FoBulkRow[]>();
      rows.forEach((row) => {
        const rowRequestId = safeValue(row.requestId);
        if (!rowRequestId || !lockedRequestData.has(rowRequestId)) {
          return;
        }

        const requestRows = rowsByRequestId.get(rowRequestId) ?? [];
        requestRows.push(row);
        rowsByRequestId.set(rowRequestId, requestRows);
      });

      type FoGroup = {
        foEmail: string;
        foName: string;
        rows: Array<{
          requestId: string;
          city: string;
          clientName: string;
          date: string;
          serviceType: string;
          vehicleNumber: string;
          location: string;
          serviceCost: string;
          ltpocName: string;
          ltpocPhone: string;
        }>;
        requestIds: Set<string>;
      };

      const groupedByFo = new Map<string, FoGroup>();

      for (const [requestId, requestData] of lockedRequestData.entries()) {
        const requestRows = rowsByRequestId.get(requestId) ?? [];
        if (requestRows.length === 0) {
          continue;
        }

        const resolvedFo = await resolveAssignedFo(requestData);
        if (!isValidRealEmail(resolvedFo.foEmail)) {
          throw new Error(`Invalid FO email address: ${resolvedFo.foEmail}. Please use a real email address.`);
        }

        const foGroup = groupedByFo.get(resolvedFo.foGroupKey) ?? {
          foEmail: resolvedFo.foEmail,
          foName: resolvedFo.foName,
          rows: [],
          requestIds: new Set<string>(),
        };

        requestRows.forEach((row) => {
          foGroup.rows.push({
            requestId,
            city: safeValue(row.city),
            clientName: safeValue(row.clientName),
            date: safeValue(row.createdAt),
            serviceType: safeValue(row.serviceType),
            vehicleNumber: safeValue(row.vehicleNumber),
            location: safeValue(row.vehicleAvailabilityLocation),
            serviceCost: safeValue(row.serviceCost),
            ltpocName: safeValue(row.ltpocName),
            ltpocPhone: safeValue(row.ltpocPhone),
          });
        });
        foGroup.requestIds.add(requestId);
        groupedByFo.set(resolvedFo.foGroupKey, foGroup);
      }

      if (groupedByFo.size === 0) {
        const unlockBatch = firestore.batch();
        lockedRequestData.forEach((_value, requestId) => {
          unlockBatch.update(firestore.collection('requests').doc(requestId), {
            foNotificationLock: admin.firestore.FieldValue.delete(),
          });
        });
        await unlockBatch.commit();

        res.status(200).json({ success: true, alreadySent: true, rowCount: 0, groupCount: 0 });
        return;
      }

      const sentRequestIds = new Set<string>();

      try {
        const transporter = getTransporter();

        for (const foGroup of groupedByFo.values()) {
          const recipientEmail = resolveRecipientEmail(foGroup.foEmail);

          const headers = [
            'Request ID',
            'City',
            'Client',
            'Date',
            'Service Type',
            'Vehicle Number',
            'Location',
            'Service Cost',
            'LTPOC Name',
            'LTPOC Phone',
          ];

          const csvRows = foGroup.rows.map((row) => [
            row.requestId,
            row.city,
            row.clientName,
            row.date,
            row.serviceType,
            row.vehicleNumber,
            row.location,
            row.serviceCost,
            row.ltpocName,
            row.ltpocPhone,
          ]);

          const csvBuffer = buildCsvBuffer(headers, csvRows);

          const tableRows = foGroup.rows
            .slice(0, 20)
            .map(
              (row) => `
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.city}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.clientName}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.date}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.serviceType}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.vehicleNumber}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.location}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.serviceCost}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.ltpocName}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${row.ltpocPhone}</td>
                </tr>
              `
            )
            .join('');

          // Build vendor follow-up contact information for bulk FO email
          const bulkVendorContactInfo = `
            <div style="margin: 30px 0; padding: 20px; background: #e7f3ff; border-left: 5px solid #2196F3; border-radius: 4px;">
              <p style="margin: 0 0 12px; color: #0d47a1; font-size: 15px; font-weight: 600;">📞 Vendor Follow-Up Contact:</p>
              <p style="margin: 0; color: #1565c0; font-size: 14px;"><strong>FleetX:</strong> ${vendorEmailMap.FleetX || 'Not configured'}</p>
              <p style="margin: 8px 0 0; color: #1565c0; font-size: 14px;"><strong>WheelsEye:</strong> ${vendorEmailMap.WheelsEye || 'Not configured'}</p>
            </div>
          `;

          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'no-reply@gps-automation.local',
            to: recipientEmail,
            subject: 'GPS Service Initiated – Assigned Request Summary',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto;">
                <h2>Assigned Request Summary</h2>
                <p>Dear ${foGroup.foName},</p>
                <p>The vendor team has shared an updated consolidated request summary.</p>
                <p>Please find the attached CSV for full request-level and service-level details.</p>
                <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
                  <thead>
                    <tr style="background: #f5f5f5;">
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">City</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Client</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Service Type</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Vehicle Number</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Location</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Service Cost</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">LTPOC Name</th>
                      <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">LTPOC Phone</th>
                    </tr>
                  </thead>
                  <tbody>${tableRows}</tbody>
                </table>
                <p style="margin-top: 12px; color: #666;">For further contacts, please reach vendors on email: FleetX - ${vendorEmailMap.FleetX || 'Not configured'}, WheelsEye - ${vendorEmailMap.WheelsEye || 'Not configured'}.</p>
                ${bulkVendorContactInfo}
              </div>
            `,
            text: `Dear Field Operator,\n\nThe vendor team has shared an updated consolidated request summary.\n\nPlease find the attached CSV for full request-level and service-level details.\n\nFor further contacts, please reach vendors on email:\nFleetX → ${vendorEmailMap.FleetX || 'Not configured'}\nWheelsEye → ${vendorEmailMap.WheelsEye || 'Not configured'}`,
            attachments: [
              {
                filename: `fo_assigned_requests_${new Date().toISOString().slice(0, 10)}.csv`,
                content: csvBuffer,
              },
            ],
          });

          const successBatch = firestore.batch();
          foGroup.requestIds.forEach((requestId) => {
            successBatch.update(firestore.collection('requests').doc(requestId), {
              foNotified: true,
              foNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
              notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
              foBulkNotifiedAt: new Date().toISOString(),
              foBulkNotificationSentAt: new Date().toISOString(),
              foNotificationLock: admin.firestore.FieldValue.delete(),
            });
            sentRequestIds.add(requestId);
          });
          await successBatch.commit();
        }
      } catch (emailError) {
        const releaseBatch = firestore.batch();
        lockedRequestData.forEach((_value, requestId) => {
          if (sentRequestIds.has(requestId)) {
            return;
          }

          releaseBatch.update(firestore.collection('requests').doc(requestId), {
            foNotificationLock: admin.firestore.FieldValue.delete(),
          });
        });
        await releaseBatch.commit();
        throw emailError;
      }

      const totalRows = [...groupedByFo.values()].reduce((sum, group) => sum + group.rows.length, 0);
      res.status(200).json({
        success: true,
        rowCount: totalRows,
        groupCount: groupedByFo.size,
        requestCount: sentRequestIds.size,
        requestIds: Array.from(sentRequestIds),
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'UNAUTHORIZED_MISSING_TOKEN' || error.message === 'UNAUTHORIZED_INVALID_TOKEN') {
          res.status(401).json({ error: 'Unauthorized. Valid Firebase auth token is required.' });
          return;
        }

        if (error.message === 'UNAUTHORIZED_USER_NOT_FOUND' || error.message === 'FORBIDDEN_VENDOR_COORDINATOR_ONLY') {
          res.status(403).json({ error: 'Forbidden. Only Vendor Coordinator can notify FO.' });
          return;
        }

        if (error.message.includes('Assigned FO user not found') || error.message.includes('FO email not available')) {
          res.status(400).json({ error: error.message });
          return;
        }
      }

      res.status(500).json({ error: 'Failed to send FO bulk notification.' });
    }
  });
});

export const notifyFO = onRequest((req, res) => {
  return corsHandler(req, res, async () => {
    try {
      const payload = req.method === 'GET' ? req.query : req.body;
      const getParam = (value: unknown) => (Array.isArray(value) ? value[0] : value);
      const payloadRecord = payload as Record<string, unknown>;

      const vehicleId = getParam(payloadRecord.vehicleId) as string | undefined;
      const installationDateParam = getParam(payloadRecord.installationDate) as string | undefined;
      const requestId = getParam(payloadRecord.requestId) as string | undefined;
      const vendorName = getParam(payloadRecord.vendorName) as string | undefined;
      const clientName = getParam(payloadRecord.clientName) as string | undefined;
      const city = getParam(payloadRecord.city) as string | undefined;
      const serviceType = getParam(payloadRecord.serviceType) as string | undefined;
      const vehicleAvailabilityLocation = getParam(payloadRecord.vehicleAvailabilityLocation) as string | undefined;
      const vehicleAvailableTime = getParam(payloadRecord.vehicleAvailableTime) as string | undefined;
      const ltpocName = getParam(payloadRecord.ltpocName) as string | undefined;
      const ltpocPhone = getParam(payloadRecord.ltpocPhone) as string | undefined;
      const ltpocEmail = getParam(payloadRecord.ltpocEmail) as string | undefined;

      // Validation
      if (!vehicleId) {
        res.status(400).json({ error: 'Vehicle ID is required.' });
        return;
      }

      if (!requestId) {
        res.status(400).json({ error: 'Request ID is required to resolve FO email.' });
        return;
      }

      // Check if notification already sent for this vehicle to prevent duplicates
      const requestRef = firestore.collection('requests').doc(requestId);
      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) {
        res.status(404).json({ error: `Request not found: ${requestId}.` });
        return;
      }

      const requestData = requestDoc.data() as Record<string, any>;
      
      // Check if FO notification was already sent for this vehicle
      const sentNotifications = (requestData?.notificationsSentToFO || []) as string[];
      if (sentNotifications.includes(vehicleId)) {
        if (req.method === 'GET') {
          res.status(200).send(`
            <div style="font-family: Arial, sans-serif; padding: 24px;">
              <h2 style="margin: 0 0 12px;">Notify FO</h2>
              <p style="margin: 0; color: #ff9800; font-weight: bold;">✓ Notification already sent for vehicle <strong>${safeValue(vehicleId)}</strong>.</p>
              <p style="margin: 12px 0 0; color: #666; font-size: 14px;">This prevents duplicate emails to the Field Operator.</p>
            </div>
          `);
          return;
        }
        res.status(200).json({
          success: true,
          message: 'Notification already sent for this vehicle.',
          vehicleId,
          alreadySent: true,
        });
        return;
      }

      const createdBy = requestData?.createdBy as string | undefined;
      if (!createdBy) {
        res.status(400).json({ error: `Request ${requestId} does not have a createdBy user.` });
        return;
      }

      const userDoc = await firestore.collection('users').doc(createdBy).get();
      if (!userDoc.exists) {
        res.status(404).json({ error: `FO user not found: ${createdBy}.` });
        return;
      }

      const userData = userDoc.data() as Record<string, any>;
      const foEmail = safeValue(userData?.email);
      const foName = safeValue(userData?.name) || safeValue(userData?.userName) || 'Field Operator';
      if (!foEmail) {
        res.status(400).json({ error: `FO email not available for user: ${createdBy}.` });
        return;
      }

      if (!isValidRealEmail(foEmail)) {
        console.warn(`⚠️ Rejecting obviously fake FO email: ${foEmail}`);
        res.status(400).json({ error: `Invalid FO email address: ${foEmail}. Please use a real email address.` });
        return;
      }

      const recipientEmail = resolveRecipientEmail(foEmail);

      const requestVendorName = safeValue(requestData?.vendorName || requestData?.serviceType);
      const requestClientName = safeValue(requestData?.clientName);
      const requestCity = safeValue(requestData?.city);
      const requestServiceType = safeValue(requestData?.serviceType);
      const requestVehicleAvailabilityLocation = safeValue(requestData?.vehicleAvailabilityLocation);
      const requestVehicleAvailableTime = safeValue(requestData?.vehicleAvailableTime);
      const requestLtpoc = Array.isArray(requestData?.ltpocDetails)
        ? requestData.ltpocDetails.find((entry: any) => entry?.vehicleNumber === vehicleId)
        : null;

      const installationDate = safeValue(installationDateParam) || new Date().toLocaleDateString();
      const safeVehicleId = safeValue(vehicleId);
      const safeVendorName = safeValue(vendorName) || requestVendorName;
      const safeLtpocName = safeValue(ltpocName) || safeValue(requestLtpoc?.ltpocName);
      const safeLtpocPhone = safeValue(ltpocPhone) || safeValue(requestLtpoc?.ltpocPhone);
      const safeLtpocEmail = safeValue(ltpocEmail) || safeValue(requestLtpoc?.ltpocEmail);

      let requestDetailsRows = '';
      requestDetailsRows += `
        <tr style="background: #f8f9fa;">
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600; width: 35%;">Service Status</td>
          <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>GPS Service Initiated</strong></td>
        </tr>
      `;
      if (safeValue(requestId)) {
        requestDetailsRows += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600; width: 35%;">Request ID</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeValue(requestId)}</strong></td>
          </tr>
        `;
      }
      if (safeVendorName) {
        requestDetailsRows += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vendor Name</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeVendorName}</strong></td>
          </tr>
        `;
      }
      const resolvedServiceType = safeValue(serviceType) || requestServiceType;
      if (resolvedServiceType) {
        requestDetailsRows += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Service Type</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${resolvedServiceType}</td>
          </tr>
        `;
      }
      const resolvedCity = safeValue(city) || requestCity;
      if (resolvedCity) {
        requestDetailsRows += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">City</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${resolvedCity}</td>
          </tr>
        `;
      }
      const resolvedClientName = safeValue(clientName) || requestClientName;
      if (resolvedClientName) {
        requestDetailsRows += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Client</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${resolvedClientName}</td>
          </tr>
        `;
      }
      const resolvedVehicleAvailabilityLocation =
        safeValue(vehicleAvailabilityLocation) || requestVehicleAvailabilityLocation;
      if (resolvedVehicleAvailabilityLocation) {
        requestDetailsRows += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vehicle Availability Location</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${resolvedVehicleAvailabilityLocation}</td>
          </tr>
        `;
      }
      const resolvedVehicleAvailableTime =
        safeValue(vehicleAvailableTime) || requestVehicleAvailableTime;
      if (resolvedVehicleAvailableTime) {
        requestDetailsRows += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vehicle Available Time</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;">${resolvedVehicleAvailableTime}</td>
          </tr>
        `;
      }

      const requestDetailsTable = requestDetailsRows
        ? `
          <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
            <tr style="background: #1f6f78; color: white;">
              <th colspan="2" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">REQUEST DETAILS</th>
            </tr>
            ${requestDetailsRows}
          </table>
        `
        : '';

      let foDetailsTable = `
        <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 30px; border-radius: 8px; overflow: hidden;">
          <tr style="background: #667eea; color: white;">
            <th colspan="2" style="padding: 16px; text-align: left; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;">INSTALLATION DETAILS</th>
          </tr>
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600; width: 35%;">Vehicle Number</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeVehicleId || '-'}</strong></td>
          </tr>
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Vendor Name</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeVendorName || '-'}</strong></td>
          </tr>
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">Installation Date</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${installationDate}</strong></td>
          </tr>
      `;

      if (safeLtpocName) {
        foDetailsTable += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">LTPOC Name</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeLtpocName}</strong></td>
          </tr>`;
      }

      if (safeLtpocPhone) {
        foDetailsTable += `
          <tr style="background: #f8f9fa;">
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">LTPOC Phone</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeLtpocPhone}</strong></td>
          </tr>`;
      }

      if (safeLtpocEmail) {
        foDetailsTable += `
          <tr>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0; font-weight: 600;">LTPOC Email</td>
            <td style="padding: 14px; border-bottom: 1px solid #e0e0e0;"><strong>${safeLtpocEmail}</strong></td>
          </tr>`;
      }

      foDetailsTable += `</table>`;

      // Build vendor follow-up contact information
      const vendorContactInfo = `
        <div style="margin: 30px 0; padding: 20px; background: #e7f3ff; border-left: 5px solid #2196F3; border-radius: 4px;">
          <p style="margin: 0 0 12px; color: #0d47a1; font-size: 15px; font-weight: 600;">📞 Vendor Follow-Up Contact:</p>
          <p style="margin: 0; color: #1565c0; font-size: 14px;"><strong>FleetX:</strong> ${vendorEmailMap.FleetX || 'Not configured'}</p>
          <p style="margin: 8px 0 0; color: #1565c0; font-size: 14px;"><strong>WheelsEye:</strong> ${vendorEmailMap.WheelsEye || 'Not configured'}</p>
        </div>
      `;

      const transporter = getTransporter();
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@gps-automation.local',
        to: recipientEmail,
        subject: `GPS Service Initiated Notification – ${vehicleId}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #28a745 0%, #20873a 100%); padding: 30px; text-align: center;">
              <h2 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.02em;">✓ GPS Service Initiated</h2>
            </div>
            
            <div style="padding: 40px; background: #fafbfc;">
              <p style="font-size: 16px; color: #333; margin-bottom: 30px;">Dear <strong>${foName}</strong>,</p>
              
              <div style="padding: 20px; background: #d4edda; border-left: 5px solid #28a745; border-radius: 4px; margin-bottom: 30px;">
                <p style="margin: 0; color: #155724; font-size: 15px;"><strong>✓ GPS Service Initiated</strong></p>
                <p style="margin: 8px 0 0; color: #155724; font-size: 14px;">The GPS service has been initiated for vehicle <strong>${safeVehicleId}</strong>.</p>
              </div>

              ${requestDetailsTable}

              ${foDetailsTable}

              <div style="margin: 30px 0; padding: 20px; background: #d1ecf1; border-left: 5px solid #17a2b8; border-radius: 4px;">
                <p style="margin: 0; color: #0c5460; font-size: 14px;"><strong>ℹ️ Next Steps:</strong> Please verify the installation and update the request status in the system.</p>
              </div>

              ${vendorContactInfo}
            </div>
            
            <div style="padding: 20px; background: #f8f9fa; color: #6c757d; font-size: 12px; text-align: center; border-top: 1px solid #dee2e6;">
              <p style="margin: 0;">GPS Installation Automation System</p>
            </div>
          </div>
        `,
        text: `GPS Service Initiated Notification\n\nDear Field Operator,\n\nThe GPS service has been initiated for vehicle ${vehicleId}.\nService Status: GPS Service Initiated\n\nInstallation Date: ${installationDate}\n\nPlease verify the installation and update the request status in the system.\n\nVendor Follow-Up Contact:\nFleetX → ${vendorEmailMap.FleetX || 'Not configured'}\nWheelsEye → ${vendorEmailMap.WheelsEye || 'Not configured'}\n\nGPS Installation Automation System`,
      });
      
      await requestRef.update({
        notificationsSentToFO: admin.firestore.FieldValue.arrayUnion(vehicleId),
        lastFONotificationTime: new Date().toISOString(),
      });

      if (req.method === 'GET') {
        res.status(200).send(`
          <div style="font-family: Arial, sans-serif; padding: 24px;">
            <h2 style="margin: 0 0 12px;">Notify FO</h2>
            <p style="margin: 0;">Notification sent successfully for vehicle <strong>${safeVehicleId}</strong>.</p>
          </div>
        `);
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Field Operator notification sent successfully.',
        foEmail: recipientEmail,
        vehicleId,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to send FO notification', details: (error as Error).message });
    }
  });
});
