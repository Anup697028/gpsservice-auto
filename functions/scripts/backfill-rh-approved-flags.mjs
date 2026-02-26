import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const requestIdsArg = args.find((arg) => arg.startsWith('--requestIds='));
const prefixesArg = args.find((arg) => arg.startsWith('--prefixes='));
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = Number(limitArg ? limitArg.split('=')[1] : 0);

const requestIds = requestIdsArg
  ? requestIdsArg
      .split('=')[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : [];

const prefixes = prefixesArg
  ? prefixesArg
      .split('=')[1]
      .split(',')
      .map((item) => item.trim().replace(/\.+$/g, ''))
      .filter(Boolean)
  : [];

const hasRhApprovalSignal = (data) => {
  if (data.rhApproval === true) return true;
  if (data.rhActionTaken === true && data.rhStatus === 'APPROVED') return true;
  if (data.rhStatus === 'APPROVED') return true;
  if (Boolean(data.rhApprovedAt)) return true;

  if (Array.isArray(data.history)) {
    return data.history.some((entry) => {
      const action = String(entry?.action || '');
      return action === 'RH_APPROVE' || action === 'RH_EDIT_APPROVE' || action === 'RH_BULK_APPROVE';
    });
  }

  return false;
};

const hasRhRejectionSignal = (data) => {
  if (data.rhStatus === 'REJECTED') return true;

  if (Array.isArray(data.history)) {
    return data.history.some((entry) => {
      const action = String(entry?.action || '');
      return action === 'RH_REJECT' || action === 'RH_BULK_REJECT';
    });
  }

  return false;
};

const shouldIncludeDoc = (docId) => {
  if (requestIds.length > 0) {
    return requestIds.includes(docId);
  }

  if (prefixes.length > 0) {
    return prefixes.some((prefix) => docId.startsWith(prefix));
  }

  return true;
};

const getCandidateDocs = async () => {
  if (requestIds.length > 0) {
    const docs = await Promise.all(requestIds.map((id) => db.collection('requests').doc(id).get()));
    return docs.filter((doc) => doc.exists);
  }

  let query = db.collection('requests').orderBy('createdAt', 'desc');
  if (limit > 0) {
    query = query.limit(limit);
  }

  const snapshot = await query.get();
  return snapshot.docs.filter((doc) => shouldIncludeDoc(doc.id));
};

const main = async () => {
  console.log(`Apply updates: ${apply}`);
  console.log(`Target by requestIds: ${requestIds.length > 0 ? requestIds.join(', ') : 'none'}`);
  console.log(`Target by prefixes: ${prefixes.length > 0 ? prefixes.join(', ') : 'none'}`);
  console.log(`Limit: ${limit > 0 ? limit : 'none'}`);

  const docs = await getCandidateDocs();
  if (docs.length === 0) {
    console.log('No matching requests found.');
    return;
  }

  let scanned = 0;
  let fixable = 0;
  let updated = 0;

  for (const doc of docs) {
    scanned += 1;
    const data = doc.data() || {};

    const approvedSignal = hasRhApprovalSignal(data);
    const rejectedSignal = hasRhRejectionSignal(data);

    const needsBackfill =
      approvedSignal &&
      !rejectedSignal &&
      (data.rhApproval !== true || data.rhActionTaken !== true || data.rhStatus !== 'APPROVED');

    if (!needsBackfill) {
      continue;
    }

    fixable += 1;

    const updates = {
      rhApproval: true,
      rhActionTaken: true,
      rhStatus: 'APPROVED',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({
        userId: 'system-backfill',
        userName: 'system-backfill',
        role: 'ADMIN',
        action: 'RH_APPROVE',
        statusFrom: data.status || null,
        statusTo: data.status || null,
        timestamp: new Date(),
        notes: 'One-time backfill: normalized RH approval flags from existing approval signals',
      }),
    };

    console.log(`[MATCH] ${doc.id} | status=${String(data.status || '')} | rhApproval=${String(data.rhApproval)} | rhActionTaken=${String(data.rhActionTaken)} | rhStatus=${String(data.rhStatus || '')}`);

    if (apply) {
      await doc.ref.update(updates);
      updated += 1;
      console.log(`[UPDATED] ${doc.id}`);
    }
  }

  console.log(`\nDone. Scanned: ${scanned}, Fixable: ${fixable}, Updated: ${updated}`);
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to persist changes.');
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('RH backfill failed:', error);
    process.exit(1);
  });
