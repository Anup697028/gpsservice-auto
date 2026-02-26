import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const args = process.argv.slice(2);
const prefixesArg = args.find((arg) => arg.startsWith('--prefixes='));

if (!prefixesArg) {
  console.error('Usage: node scripts/inspect-rh-state.mjs --prefixes=id1,id2');
  process.exit(1);
}

const prefixes = prefixesArg
  .split('=')[1]
  .split(',')
  .map((item) => item.trim().replace(/\.+$/g, ''))
  .filter(Boolean);

const main = async () => {
  const snapshot = await db.collection('requests').get();
  const docs = snapshot.docs.filter((doc) => prefixes.some((prefix) => doc.id.startsWith(prefix)));

  console.log(`Matched ${docs.length} request(s)`);

  for (const doc of docs) {
    const data = doc.data() || {};
    const history = Array.isArray(data.history) ? data.history : [];
    const rhActions = history
      .filter((entry) => {
        const action = String(entry?.action || '');
        return action.startsWith('RH_');
      })
      .map((entry) => String(entry?.action || ''));

    console.log(JSON.stringify({
      id: doc.id,
      status: data.status || null,
      isBulkRequest: data.isBulkRequest === true,
      rhApproval: data.rhApproval ?? null,
      rhActionTaken: data.rhActionTaken ?? null,
      rhStatus: data.rhStatus ?? null,
      rhApprovedAt: data.rhApprovedAt ? 'SET' : null,
      paymentApproval: data.paymentApproval ?? null,
      paymentStatus: data.paymentStatus ?? null,
      paymentApprovedAt: data.paymentApprovedAt ? 'SET' : null,
      vendorNotified: data.vendorNotified ?? null,
      foNotified: data.foNotified ?? null,
      rhActions,
    }));
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Inspection failed:', error);
    process.exit(1);
  });
