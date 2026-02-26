import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArgValue = (key) => {
  const index = args.indexOf(key);
  if (index === -1 || index === args.length - 1) {
    return null;
  }
  return args[index + 1];
};

const DRY_RUN = !hasFlag('--apply');
const TARGET_REQUEST_ID = getArgValue('--requestId');
const LIMIT = Number(getArgValue('--limit') || 0);

const SERVICE_COST_BY_TYPE = {
  FleetX: 3000,
  WheelsEye: 2000,
};

const normalizeVehicles = (vehicles) => {
  if (Array.isArray(vehicles)) {
    return vehicles.map((vehicle) => ({ ...vehicle }));
  }

  if (vehicles && typeof vehicles === 'object') {
    return Object.keys(vehicles)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ({ ...(vehicles[key] || {}) }));
  }

  return [];
};

const normalizeRecordList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => ({ ...item }));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ({ ...(value[key] || {}) }));
  }

  return [];
};

const normalizeServiceType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'fleetx') {
    return 'FleetX';
  }
  if (raw === 'wheelseye') {
    return 'WheelsEye';
  }
  return '';
};

const inferServiceType = (vehicle, request) => {
  const direct =
    normalizeServiceType(vehicle.serviceType) ||
    normalizeServiceType(vehicle.service) ||
    normalizeServiceType(vehicle.vendorType) ||
    normalizeServiceType(request.serviceType) ||
    normalizeServiceType(request.vendorType);

  if (direct) {
    return direct;
  }

  const cost = Number(vehicle.serviceCost || request.serviceCost || 0);
  if (cost === 3000) {
    return 'FleetX';
  }
  if (cost === 2000) {
    return 'WheelsEye';
  }

  return '';
};

const equalJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const run = async () => {
  let query = db.collection('requests').where('isBulkRequest', '==', true);

  if (TARGET_REQUEST_ID) {
    const doc = await db.collection('requests').doc(TARGET_REQUEST_ID).get();
    if (!doc.exists) {
      console.log(`Request not found: ${TARGET_REQUEST_ID}`);
      return;
    }

    const docs = [doc];
    await processDocs(docs);
    return;
  }

  if (LIMIT > 0) {
    query = query.limit(LIMIT);
  }

  const snapshot = await query.get();
  await processDocs(snapshot.docs);
};

const processDocs = async (docs) => {
  let scanned = 0;
  let changed = 0;

  for (const doc of docs) {
    scanned += 1;

    const request = doc.data() || {};
    const originalVehicles = request.vehicles;
    const vehicles = normalizeVehicles(originalVehicles);
    const ltpocDetails = normalizeRecordList(request.ltpocDetails);

    if (vehicles.length === 0) {
      continue;
    }

    const ltpocByVehicle = new Map(
      ltpocDetails
        .filter((item) => String(item.vehicleNumber || '').trim())
        .map((item) => [String(item.vehicleNumber || '').trim(), item])
    );

    const nextVehicles = vehicles.map((vehicle, index) => {
      const next = { ...vehicle };

      const vehicleNumber = String(
        next.vehicleNumber || next.vehicleNo || next.registrationNumber || ltpocDetails[index]?.vehicleNumber || ''
      ).trim();

      if (vehicleNumber && !next.vehicleNumber) {
        next.vehicleNumber = vehicleNumber;
      }

      const serviceType = inferServiceType(next, request);
      if (serviceType && !normalizeServiceType(next.serviceType)) {
        next.serviceType = serviceType;
      }

      const matchingLtpoc = ltpocByVehicle.get(vehicleNumber) || ltpocDetails[index];
      if (matchingLtpoc) {
        if (!next.ltpocName && matchingLtpoc.ltpocName) {
          next.ltpocName = matchingLtpoc.ltpocName;
        }
        if (!next.ltpocPhone && matchingLtpoc.ltpocPhone) {
          next.ltpocPhone = matchingLtpoc.ltpocPhone;
        }
      }

      return next;
    });

    const shouldRewriteVehicles = !equalJSON(vehicles, nextVehicles) || !Array.isArray(originalVehicles);
    const shouldFixVehicleCount = Number(request.vehicleCount || 0) !== nextVehicles.length;

    if (!shouldRewriteVehicles && !shouldFixVehicleCount) {
      continue;
    }

    changed += 1;

    const updates = {
      vehicles: nextVehicles,
      vehicleCount: nextVehicles.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({
        userId: 'system-backfill',
        userName: 'system-backfill',
        role: 'ADMIN',
        action: 'FO_REMOVE_VEHICLE',
        statusFrom: request.status || null,
        statusTo: request.status || null,
        timestamp: new Date(),
        notes: 'One-time backfill: normalized bulk vehicles and restored missing service/vehicle details',
      }),
    };

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update request ${doc.id}`, {
        vehicleCount: nextVehicles.length,
      });
    } else {
      await doc.ref.update(updates);
      console.log(`[UPDATED] ${doc.id}`);
    }
  }

  console.log(`\nDone. Scanned: ${scanned}, ${DRY_RUN ? 'Would change' : 'Changed'}: ${changed}`);
  if (DRY_RUN) {
    console.log('Run with --apply to persist changes.');
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
