import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!firebaseServiceAccountPath || !fs.existsSync(firebaseServiceAccountPath)) {
  throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH is invalid: ${firebaseServiceAccountPath || 'undefined'}`);
}
const serviceAccount = JSON.parse(fs.readFileSync(firebaseServiceAccountPath, 'utf-8'));

initializeApp({
  credential: cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = getFirestore();
const prisma = new PrismaClient();

/**
 * Migrate Firestore requests to PostgreSQL
 */
async function migrateRequests() {
  console.log('📊 Starting data migration from Firestore to PostgreSQL...\n');

  try {
    // Get all requests from Firestore
    const requestsSnapshot = await db.collection('requests').get();
    console.log(`Found ${requestsSnapshot.size} requests in Firestore`);

    let migratedCount = 0;
    let errorCount = 0;
    const requestIdMapping = new Map<string, number>(); // Map Firebase ID to numeric ID

    // Process each request
    for (const doc of requestsSnapshot.docs) {
      try {
        const firebaseData = doc.data();

        // Create request in PostgreSQL
        const createdRequest = await prisma.request.create({
          data: {
            firebaseId: doc.id,
            status: firebaseData.status || 'REQUEST_CREATED',
            createdBy: firebaseData.createdBy,
            createdByEmail: firebaseData.foEmail,
            city: firebaseData.city,
            clientName: firebaseData.clientName,
            isBulkRequest: firebaseData.isBulkRequest || false,
            vehicleCount: firebaseData.vehicles?.length || 0,
            assignedRhUserId: firebaseData.assignedRhUserId,
            assignedRhEmail: firebaseData.assignedRhEmail,
            assignedRhEmailNormalized: firebaseData.assignedRhEmailNormalized,
            rhStatus: firebaseData.rhStatus,
            rhApproval: firebaseData.rhApproval || false,
            rhApprovedAt: firebaseData.rhApprovedAt?._seconds ? new Date(firebaseData.rhApprovedAt._seconds * 1000) : null,
            rejectionReason: firebaseData.rejectionReason,
            paymentStatus: firebaseData.paymentStatus,
            paymentApproved: firebaseData.paymentApproved || false,
            paymentRejected: firebaseData.paymentRejected || false,
            paymentActionTaken: firebaseData.paymentActionTaken || false,
            paymentApprovedAt: firebaseData.paymentApprovedAt?._seconds ? new Date(firebaseData.paymentApprovedAt._seconds * 1000) : null,
            paymentRejectedAt: firebaseData.paymentRejectedAt?._seconds ? new Date(firebaseData.paymentRejectedAt._seconds * 1000) : null,
            vendorName: firebaseData.vendorName,
            vendorStatus: firebaseData.vendorStatus,
            vendorNotified: firebaseData.vendorNotified || false,
            vendorApprovedAt: firebaseData.vendorApprovedAt?._seconds ? new Date(firebaseData.vendorApprovedAt._seconds * 1000) : null,
            foNotified: firebaseData.foNotified || false,
            foNotifiedAt: firebaseData.foNotifiedAt?._seconds ? new Date(firebaseData.foNotifiedAt._seconds * 1000) : null,
            createdAt: firebaseData.createdAt?._seconds ? new Date(firebaseData.createdAt._seconds * 1000) : new Date(),
          },
        });

        requestIdMapping.set(doc.id, createdRequest.id);

        // Migrate vehicles if bulk request
        if (Array.isArray(firebaseData.vehicles) && firebaseData.vehicles.length > 0) {
          for (const vehicle of firebaseData.vehicles) {
            await prisma.requestVehicle.create({
              data: {
                requestId: createdRequest.id,
                vehicleNumber: vehicle.vehicleNumber,
                city: vehicle.city,
                serviceType: vehicle.serviceType,
                rhRejected: vehicle.rhRejected || false,
                paymentApproved: vehicle.paymentApproved || false,
                paymentRejected: vehicle.paymentRejected || false,
                paymentActionTaken: vehicle.paymentActionTaken || false,
                vendorNotified: vehicle.vendorNotified || false,
                vehicleAvailabilityLocation: vehicle.vehicleAvailabilityLocation,
                vehicleAvailableTime: vehicle.vehicleAvailableTime,
              },
            });
          }
        }

        // Migrate LTPOC details
        if (Array.isArray(firebaseData.ltpocDetails) && firebaseData.ltpocDetails.length > 0) {
          for (const ltpoc of firebaseData.ltpocDetails) {
            await prisma.ltpocDetail.create({
              data: {
                requestId: createdRequest.id,
                vehicleNumber: ltpoc.vehicleNumber,
                ltpocName: ltpoc.ltpocName,
                ltpocPhone: ltpoc.ltpocPhone,
              },
            });
          }
        }

        // Migrate history entries
        if (Array.isArray(firebaseData.history) && firebaseData.history.length > 0) {
          for (const entry of firebaseData.history) {
            await prisma.requestHistory.create({
              data: {
                requestId: createdRequest.id,
                userId: entry.userId,
                userName: entry.userName,
                role: entry.role,
                action: entry.action,
                statusFrom: entry.statusFrom,
                statusTo: entry.statusTo,
                notes: entry.notes,
                createdAt: entry.timestamp?._seconds ? new Date(entry.timestamp._seconds * 1000) : new Date(),
              },
            });
          }
        }

        migratedCount++;
        if (migratedCount % 10 === 0) {
          console.log(`✅ Migrated ${migratedCount} requests...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error migrating request ${doc.id}:`, error);
      }
    }

    console.log(`\n✨ Migration complete!`);
    console.log(`📊 Summary:`);
    console.log(`   ✅ Migrated: ${migratedCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log(`   📝 Total: ${migratedCount + errorCount}`);

    // Show ID mapping sample
    const firstFewMappings = Array.from(requestIdMapping.entries()).slice(0, 5);
    if (firstFewMappings.length > 0) {
      console.log(`\n🔗 Sample ID Mappings (Firebase ID → Numeric ID):`);
      firstFewMappings.forEach(([fbId, numId]) => {
        console.log(`   ${fbId.substring(0, 12)}... → ${numId}`);
      });
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

/**
 * Migrate users to PostgreSQL
 */
async function migrateUsers() {
  console.log('👥 Migrating users from Firestore...\n');

  try {
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.size} users in Firestore`);

    let migratedCount = 0;

    for (const doc of usersSnapshot.docs) {
      try {
        const userData = doc.data();

        await prisma.user.create({
          data: {
            id: doc.id,
            email: userData.email || '',
            emailNormalized: (userData.email || '').toLowerCase(),
            role: userData.role,
            name: userData.name,
            employeeId: userData.employeeId,
            phoneNumber: userData.phoneNumber,
            profileCompleted: userData.profileCompleted || false,
          },
        });

        migratedCount++;
      } catch (error) {
        // If user already exists, skip
        if ((error as any).code === 'P2002') {
          continue;
        }
        console.error(`Error migrating user ${doc.id}:`, error);
      }
    }

    console.log(`✅ Migrated ${migratedCount} users\n`);
  } catch (error) {
    console.error('❌ User migration failed:', error);
  }
}

/**
 * Main migration flow
 */
async function runMigration() {
  console.log('\n🔄 Starting Firestore → PostgreSQL Migration');
  console.log(`📅 ${new Date().toISOString()}\n`);

  try {
    // Migrate users first
    await migrateUsers();

    // Then migrate requests
    await migrateRequests();

    console.log('\n✨ All migrations completed successfully!\n');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration();
