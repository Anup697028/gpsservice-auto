import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

const projectId = 'gps-integration-b1a2e';

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: fs.readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', 'rh_user'), { role: 'RH', email: 'rh@test.com' });
    await setDoc(doc(db, 'users', 'vendor_user'), { role: 'VENDOR', email: 'vendor@test.com' });

    await setDoc(doc(db, 'requests', 'bulk_for_rh'), {
      createdBy: 'fo_user',
      isBulkRequest: true,
      status: 'FO_CREATED',
      rhStatus: 'PENDING',
      bothApproved: false,
      history: [],
    });

    await setDoc(doc(db, 'requests', 'bulk_for_vendor_fo'), {
      createdBy: 'fo_user',
      isBulkRequest: true,
      status: 'SERVICE_INITIATED',
      bothApproved: true,
      foNotified: false,
      history: [],
    });
  });

  const rhDb = testEnv.authenticatedContext('rh_user').firestore();
  await assertSucceeds(
    updateDoc(doc(rhDb, 'requests', 'bulk_for_rh'), {
      rhStatus: 'APPROVED',
      updatedAt: serverTimestamp(),
    })
  );

  const vendorDb = testEnv.authenticatedContext('vendor_user').firestore();
  await assertSucceeds(
    updateDoc(doc(vendorDb, 'requests', 'bulk_for_vendor_fo'), {
      foNotified: true,
      notifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  console.log('PASS: RH bulk approval and Vendor Notify FO rule checks succeeded.');
} catch (error) {
  console.error('FAIL:', error);
  process.exitCode = 1;
} finally {
  await testEnv.cleanup();
}
