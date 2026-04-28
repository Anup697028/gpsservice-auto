const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { PrismaClient } = require('@prisma/client');
const { loadSecrets, getJsonSecret, getSecret } = require('./secrets-manager.cjs');

;(async () => {

async function initializeFirebase() {
  await loadSecrets({ secrets: ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_PROJECT_ID'] });

  const serviceAccount = getJsonSecret('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing from Secret Manager.');
  }

  initializeApp({
    credential: cert(serviceAccount),
    projectId: String(getSecret('FIREBASE_PROJECT_ID') || serviceAccount.project_id || '').trim() || undefined,
  });
}

await initializeFirebase();

const db = getFirestore();
const prisma = new PrismaClient();

const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);
const formatRequestId = (value) => `REQ-${String(value).padStart(6, '0')}`;
const toDate = (value) => {
  if (!value) {
    return new Date();
  }

  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const mapRequestCore = (data) => ({
  firebaseId: null,
  status: String(data.status || 'REQUEST_CREATED').trim() || 'REQUEST_CREATED',
  createdBy: data.createdBy || null,
  createdByEmail: data.foEmail || null,
  city: data.city || null,
  clientName: data.clientName || null,
  isBulkRequest: data.isBulkRequest === true,
  vehicleCount: Array.isArray(data.vehicles) ? data.vehicles.length : Number(data.vehicleCount || 0),
  assignedRhUserId: data.assignedRhUserId || null,
  assignedRhEmail: data.assignedRhEmail || null,
  assignedRhEmailNormalized: data.assignedRhEmailNormalized || null,
  rhStatus: data.rhStatus || null,
  rhApproval: data.rhApproval === true,
  rhApprovedAt: data.rhApprovedAt ? toDate(data.rhApprovedAt) : null,
  rhApprovalNotes: data.rhApprovalNotes || null,
  rhRejectedAt: data.rhRejectedAt ? toDate(data.rhRejectedAt) : null,
  rejectionReason: data.rejectionReason || null,
  paymentStatus: data.paymentStatus || null,
  paymentApproved: data.paymentApproved === true,
  paymentRejected: data.paymentRejected === true,
  paymentActionTaken: data.paymentActionTaken === true,
  paymentApprovedAt: data.paymentApprovedAt ? toDate(data.paymentApprovedAt) : null,
  paymentRejectedAt: data.paymentRejectedAt ? toDate(data.paymentRejectedAt) : null,
  paymentApproverName: data.paymentApproverName || null,
  vendorName: data.vendorName || null,
  vendorStatus: data.vendorStatus || null,
  vendorNotified: data.vendorNotified === true,
  vendorApprovedBy: data.vendorApprovedBy || null,
  vendorApprovedAt: data.vendorApprovedAt ? toDate(data.vendorApprovedAt) : null,
  vendorBulkMailSentAt: data.vendorBulkMailSentAt ? toDate(data.vendorBulkMailSentAt) : null,
  assignedFoId: data.assignedFoId || null,
  assignedFoEmail: data.assignedFoEmail || null,
  foNotified: data.foNotified === true,
  foNotifiedAt: data.foNotifiedAt ? toDate(data.foNotifiedAt) : null,
  foBulkNotifyEnabled: data.foBulkNotifyEnabled === true,
});

const mapVehicleCreate = (vehicle) => ({
  vehicleNumber: String(vehicle?.vehicleNumber || '').trim() || null,
  city: String(vehicle?.city || '').trim() || null,
  serviceType: String(vehicle?.serviceType || '').trim() || null,
  rhRejected: vehicle?.rhRejected === true,
  rhRejectionReason: String(vehicle?.rhRejectionReason || '').trim() || null,
  paymentApproved: vehicle?.paymentApproved === true,
  paymentRejected: vehicle?.paymentRejected === true,
  paymentActionTaken: vehicle?.paymentActionTaken === true,
  paymentApprovedAt: vehicle?.paymentApprovedAt ? toDate(vehicle.paymentApprovedAt) : null,
  paymentRejectedAt: vehicle?.paymentRejectedAt ? toDate(vehicle.paymentRejectedAt) : null,
  paymentRejectionReason: String(vehicle?.paymentRejectionReason || '').trim() || null,
  vendorNotified: vehicle?.vendorNotified === true,
  vendorName: String(vehicle?.vendorName || '').trim() || null,
  vehicleAvailabilityLocation: String(vehicle?.vehicleAvailabilityLocation || '').trim() || null,
  vehicleAvailableTime: String(vehicle?.vehicleAvailableTime || '').trim() || null,
});

const mapLtpocCreate = (row) => ({
  vehicleNumber: String(row?.vehicleNumber || '').trim() || null,
  ltpocName: String(row?.ltpocName || row?.lptocName || '').trim() || null,
  ltpocPhone: normalizePhone(row?.ltpocPhone || row?.lptocPhone || ''),
});

const mapHistoryCreate = (entry, fallbackUser) => ({
  userId: String(entry?.userId || fallbackUser?.id || '').trim() || null,
  userName: String(entry?.userName || fallbackUser?.name || fallbackUser?.email || '').trim() || null,
  role: String(entry?.role || fallbackUser?.role || 'FO').trim().toUpperCase() || 'FO',
  action: String(entry?.action || 'CREATE').trim().toUpperCase() || 'CREATE',
  statusFrom: entry?.statusFrom ? String(entry.statusFrom).trim().toUpperCase() : null,
  statusTo: entry?.statusTo ? String(entry.statusTo).trim().toUpperCase() : null,
  notes: String(entry?.notes || '').trim() || null,
  createdAt: entry?.timestamp ? toDate(entry.timestamp) : new Date(),
});

async function restoreUsers() {
  const snapshot = await db.collection('users').get();
  let restored = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    await prisma.user.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        email: String(data.email || '').trim(),
        emailNormalized: String(data.email || '').trim().toLowerCase(),
        role: data.role || null,
        name: data.name || null,
        employeeId: data.employeeId || null,
        phoneNumber: data.phoneNumber || null,
        profileCompleted: data.profileCompleted === true,
      },
      update: {
        email: String(data.email || '').trim(),
        emailNormalized: String(data.email || '').trim().toLowerCase(),
        role: data.role || null,
        name: data.name || null,
        employeeId: data.employeeId || null,
        phoneNumber: data.phoneNumber || null,
        profileCompleted: data.profileCompleted === true,
      },
    });
    restored += 1;
  }

  console.log(`Restored ${restored} users`);
}

async function restoreRequests() {
  const snapshot = await db.collection('requests').get();
  let restored = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const requestData = mapRequestCore(data);
    requestData.firebaseId = doc.id;

    const existing = await prisma.request.findUnique({ where: { firebaseId: doc.id } });

    let requestRow;
    if (existing) {
      requestRow = await prisma.request.update({
        where: { id: existing.id },
        data: requestData,
      });

      await prisma.requestVehicle.deleteMany({ where: { requestId: requestRow.id } });
      await prisma.ltpocDetail.deleteMany({ where: { requestId: requestRow.id } });
      await prisma.requestHistory.deleteMany({ where: { requestId: requestRow.id } });
    } else {
      requestRow = await prisma.request.create({
        data: {
          ...requestData,
          vehicles: {
            create: Array.isArray(data.vehicles) ? data.vehicles.map(mapVehicleCreate) : [],
          },
          ltpocDetails: {
            create: Array.isArray(data.ltpocDetails) ? data.ltpocDetails.map(mapLtpocCreate) : [],
          },
          history: {
            create: Array.isArray(data.history)
              ? data.history.map((entry) => mapHistoryCreate(entry, {
                  id: data.createdBy || null,
                  name: data.createdByName || null,
                  email: data.createdByEmail || data.foEmail || null,
                  role: data.createdByRole || 'FO',
                }))
              : [],
          },
        },
      });
    }

    if (!existing) {
      const nextDisplayId = formatRequestId(requestRow.id);
      await prisma.request.update({
        where: { id: requestRow.id },
        data: { requestDisplayId: nextDisplayId },
      });
    } else {
      await prisma.request.update({
        where: { id: requestRow.id },
        data: { requestDisplayId: formatRequestId(requestRow.id) },
      });

      await prisma.requestVehicle.createMany({
        data: Array.isArray(data.vehicles) ? data.vehicles.map(mapVehicleCreate).map((vehicle) => ({ ...vehicle, requestId: requestRow.id })) : [],
      });

      await prisma.ltpocDetail.createMany({
        data: Array.isArray(data.ltpocDetails) ? data.ltpocDetails.map(mapLtpocCreate).map((row) => ({ ...row, requestId: requestRow.id })) : [],
      });

      await prisma.requestHistory.createMany({
        data: Array.isArray(data.history)
          ? data.history.map((entry) => mapHistoryCreate(entry, {
              id: data.createdBy || null,
              name: data.createdByName || null,
              email: data.createdByEmail || data.foEmail || null,
              role: data.createdByRole || 'FO',
            })).map((entry) => ({ ...entry, requestId: requestRow.id }))
          : [],
      });
    }

    restored += 1;
    if (restored % 10 === 0) {
      console.log(`Restored ${restored} requests...`);
    }
  }

  console.log(`Restored ${restored} requests`);
}

async function main() {
  try {
    console.log('Starting Firestore restore into PostgreSQL...');
    await restoreUsers();
    await restoreRequests();
    console.log('Restore complete.');
  } catch (error) {
    console.error('Restore failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();

})();
