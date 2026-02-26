import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'both').toLowerCase();
const prefixesArg = args.find((arg) => arg.startsWith('--prefixes='));

if (!prefixesArg) {
  console.error('Missing --prefixes argument. Example: --prefixes=6VI6MVmp,WqGInWJS');
  process.exit(1);
}

if (!['vendor', 'fo', 'both'].includes(mode)) {
  console.error('Invalid --mode. Allowed: vendor | fo | both');
  process.exit(1);
}

const prefixes = prefixesArg
  .split('=')[1]
  .split(',')
  .map((item) => item.trim().replace(/\.+$/g, ''))
  .filter(Boolean);

if (prefixes.length === 0) {
  console.error('No valid prefixes provided.');
  process.exit(1);
}

const matchesPrefix = (id) => prefixes.some((prefix) => id.startsWith(prefix));

const resetVehicleFlags = (vehicles, selectedMode) => {
  if (!Array.isArray(vehicles)) {
    return vehicles;
  }

  return vehicles.map((vehicle) => {
    if (!vehicle || typeof vehicle !== 'object') {
      return vehicle;
    }

    const nextVehicle = { ...vehicle };

    if (selectedMode === 'vendor' || selectedMode === 'both') {
      nextVehicle.vendorNotified = false;
    }

    if (selectedMode === 'fo' || selectedMode === 'both') {
      nextVehicle.foNotified = false;
    }

    return nextVehicle;
  });
};

const buildUpdates = (docData, selectedMode) => {
  const updates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const currentStatus = String(docData.status || '').toUpperCase();
  const isBulkRequest = docData.isBulkRequest === true;

  if (selectedMode === 'vendor' || selectedMode === 'both') {
    updates.vendorNotified = false;
    updates.vendorStatus = 'PENDING';
    updates.vendorActionTaken = false;
    updates.approvedByVendor = false;
    updates.vendorApprovedAt = admin.firestore.FieldValue.delete();
    updates.vendorApprovedBy = admin.firestore.FieldValue.delete();
    updates.notificationTimestamp = admin.firestore.FieldValue.delete();

    if (isBulkRequest) {
      if (currentStatus === 'SERVICE_INITIATED' || currentStatus === 'COMPLETED') {
        updates.status = 'PAYMENT_APPROVED';
      }
    } else if (currentStatus === 'COMPLETED') {
      updates.status = 'VENDOR_COORDINATION';
    }
  }

  if (selectedMode === 'fo' || selectedMode === 'both') {
    updates.foNotified = false;
    updates.foNotifiedAt = admin.firestore.FieldValue.delete();
    updates.foBulkNotifiedAt = admin.firestore.FieldValue.delete();
    updates.foBulkNotificationSentAt = admin.firestore.FieldValue.delete();
    updates.foNotificationLock = admin.firestore.FieldValue.delete();
    updates.notificationsSentToFO = admin.firestore.FieldValue.delete();
    updates.lastFONotificationTime = admin.firestore.FieldValue.delete();
  }

  if (Array.isArray(docData.vehicles)) {
    updates.vehicles = resetVehicleFlags(docData.vehicles, selectedMode);
  }

  return updates;
};

const main = async () => {
  console.log(`Mode: ${mode}`);
  console.log(`Apply updates: ${apply}`);
  console.log(`Prefixes: ${prefixes.join(', ')}`);

  const snapshot = await db.collection('requests').get();
  const matchedDocs = snapshot.docs.filter((doc) => matchesPrefix(doc.id));

  if (matchedDocs.length === 0) {
    console.log('No matching request IDs found.');
    return;
  }

  console.log(`Matched ${matchedDocs.length} request(s):`);
  matchedDocs.forEach((doc) => {
    const data = doc.data() || {};
    console.log(
      ` - ${doc.id} | status=${String(data.status || '')} | vendorNotified=${String(data.vendorNotified)} | foNotified=${String(data.foNotified)}`
    );
  });

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write changes.');
    return;
  }

  let batch = db.batch();
  let ops = 0;
  let batchCount = 0;

  for (const doc of matchedDocs) {
    const updates = buildUpdates(doc.data() || {}, mode);
    batch.update(doc.ref, updates);
    ops += 1;

    if (ops === 450) {
      await batch.commit();
      batchCount += 1;
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
    batchCount += 1;
  }

  console.log(`\nUpdated ${matchedDocs.length} request(s) in ${batchCount} batch(es).`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to reset notify flags:', error);
    process.exit(1);
  });
