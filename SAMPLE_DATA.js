// Sample Data for GPS Installation Automation System
// Use these to manually populate Firestore for testing

// === SAMPLE USERS ===
// Create these in Firebase Console → Authentication
// Then create corresponding documents in Firestore 'users' collection

const sampleUsers = [
  {
    uid: "user_fo_1",
    email: "operator@test.com",
    password: "password123",
    firestoreDoc: {
      email: "operator@test.com",
      role: "FO",
      createdAt: new Date()
    }
  },
  {
    uid: "user_rh_1",
    email: "head@test.com",
    password: "password123",
    firestoreDoc: {
      email: "head@test.com",
      role: "RH",
      createdAt: new Date()
    }
  },
  {
    uid: "user_payment_1",
    email: "payment@test.com",
    password: "password123",
    firestoreDoc: {
      email: "payment@test.com",
      role: "PAYMENT",
      createdAt: new Date()
    }
  },
  {
    uid: "user_vendor_1",
    email: "vendor@test.com",
    password: "password123",
    firestoreDoc: {
      email: "vendor@test.com",
      role: "VENDOR",
      createdAt: new Date()
    }
  }
];

// === SAMPLE REQUESTS ===
// Manually add these to Firestore 'requests' collection for testing

const sampleRequests = [
  {
    // REQUEST_CREATED status - waiting for RH and Payment approval
    id: "req_001",
    vehicles: [
      { vehicleNumber: "KA-01-AB-1234" },
      { vehicleNumber: "KA-01-AB-1235" }
    ],
    city: "Bangalore",
    clientName: "Tech Corp",
    driverDetails: [
      {
        vehicleNumber: "KA-01-AB-1234",
        driverName: "John Doe",
        driverNumber: "9876543210"
      },
      {
        vehicleNumber: "KA-01-AB-1235",
        driverName: "Jane Smith",
        driverNumber: "9876543211"
      }
    ],
    status: "REQUEST_CREATED",
    rhApproval: false,
    paymentApproval: false,
    vendorName: null,
    notificationTimestamp: null,
    auditLog: [
      {
        action: "Request Created",
        performedBy: "user_fo_1",
        timestamp: new Date("2024-02-10 10:00:00")
      }
    ],
    createdBy: "user_fo_1",
    createdAt: new Date("2024-02-10 10:00:00")
  },
  {
    // PARALLEL_REVIEW status - both approved
    id: "req_002",
    vehicles: [
      { vehicleNumber: "MH-02-CD-5678" },
      { vehicleNumber: "MH-02-CD-5679" }
    ],
    city: "Mumbai",
    clientName: "Auto Fleet",
    driverDetails: [
      {
        vehicleNumber: "MH-02-CD-5678",
        driverName: "Rajesh Kumar",
        driverNumber: "8765432109"
      },
      {
        vehicleNumber: "MH-02-CD-5679",
        driverName: "Priya Singh",
        driverNumber: "8765432108"
      }
    ],
    status: "PARALLEL_REVIEW",
    rhApproval: true,
    paymentApproval: true,
    vendorName: null,
    notificationTimestamp: null,
    auditLog: [
      {
        action: "Request Created",
        performedBy: "user_fo_1",
        timestamp: new Date("2024-02-09 14:20:00")
      },
      {
        action: "RH Approved",
        performedBy: "user_rh_1",
        timestamp: new Date("2024-02-09 15:30:00")
      },
      {
        action: "Payment Approved",
        performedBy: "user_payment_1",
        timestamp: new Date("2024-02-09 16:00:00")
      },
      {
        action: "Moved to Parallel Review",
        performedBy: "user_fo_1",
        timestamp: new Date("2024-02-09 16:05:00")
      }
    ],
    createdBy: "user_fo_1",
    createdAt: new Date("2024-02-09 14:20:00")
  },
  {
    // VENDOR_COORDINATION status - ready for vendor assignment
    id: "req_003",
    vehicles: [
      { vehicleNumber: "DL-01-EF-9012" }
    ],
    city: "Delhi",
    clientName: "Capital Motors",
    driverDetails: [
      {
        vehicleNumber: "DL-01-EF-9012",
        driverName: "Amit Patel",
        driverNumber: "7654321098"
      }
    ],
    status: "VENDOR_COORDINATION",
    rhApproval: true,
    paymentApproval: true,
    vendorName: null,
    notificationTimestamp: null,
    auditLog: [
      {
        action: "Request Created",
        performedBy: "user_fo_1",
        timestamp: new Date("2024-02-08 09:15:00")
      },
      {
        action: "RH Approved",
        performedBy: "user_rh_1",
        timestamp: new Date("2024-02-08 10:30:00")
      },
      {
        action: "Payment Approved",
        performedBy: "user_payment_1",
        timestamp: new Date("2024-02-08 11:00:00")
      }
    ],
    createdBy: "user_fo_1",
    createdAt: new Date("2024-02-08 09:15:00")
  },
  {
    // COMPLETED status - fully processed
    id: "req_004",
    vehicles: [
      { vehicleNumber: "KA-01-AB-1234" }
    ],
    city: "Bangalore",
    clientName: "Tech Corp",
    driverDetails: [
      {
        vehicleNumber: "KA-01-AB-1234",
        driverName: "John Doe",
        driverNumber: "9876543210"
      }
    ],
    status: "COMPLETED",
    rhApproval: true,
    paymentApproval: true,
    vendorName: "Fleetx",
    notificationTimestamp: new Date("2024-02-07 14:45:00"),
    auditLog: [
      {
        action: "Request Created",
        performedBy: "user_fo_1",
        timestamp: new Date("2024-02-07 08:00:00")
      },
      {
        action: "RH Approved",
        performedBy: "user_rh_1",
        timestamp: new Date("2024-02-07 09:30:00")
      },
      {
        action: "Payment Approved",
        performedBy: "user_payment_1",
        timestamp: new Date("2024-02-07 10:00:00")
      },
      {
        action: "Vendor Notified: Fleetx",
        performedBy: "user_vendor_1",
        timestamp: new Date("2024-02-07 14:45:00")
      }
    ],
    createdBy: "user_fo_1",
    createdAt: new Date("2024-02-07 08:00:00")
  },
  {
    // HALTED status - rejected
    id: "req_005",
    vehicles: [
      { vehicleNumber: "MH-02-CD-5678" }
    ],
    city: "Mumbai",
    clientName: "Auto Fleet",
    driverDetails: [
      {
        vehicleNumber: "MH-02-CD-5678",
        driverName: "Rajesh Kumar",
        driverNumber: "8765432109"
      }
    ],
    status: "HALTED",
    rhApproval: false,
    paymentApproval: false,
    vendorName: null,
    notificationTimestamp: null,
    auditLog: [
      {
        action: "Request Created",
        performedBy: "user_fo_1",
        timestamp: new Date("2024-02-06 12:00:00")
      },
      {
        action: "RH Rejected",
        performedBy: "user_rh_1",
        timestamp: new Date("2024-02-06 13:30:00")
      }
    ],
    createdBy: "user_fo_1",
    createdAt: new Date("2024-02-06 12:00:00")
  }
];

// === INSTRUCTIONS TO USE SAMPLE DATA ===
/*
1. Create Users in Firebase Auth:
   - Go to Firebase Console → Authentication
   - Click "Add user" for each sampleUsers entry
   - Use email and password from the sample data
   
2. Create User Documents in Firestore:
   - Go to Firestore Database
   - Create 'users' collection
   - For each user, create a document with uid as the document ID
   - Add the firestoreDoc data

3. Create Sample Requests in Firestore:
   - Create 'requests' collection
   - Manually add each sampleRequests entry as a document
   - Keep the id field as shown
   - Use current dates/timestamps instead of sample ones

4. Test Users:
   - Login with: operator@test.com / password123 → FO Dashboard
   - Login with: head@test.com / password123 → RH Dashboard
   - Login with: payment@test.com / password123 → Payment Dashboard
   - Login with: vendor@test.com / password123 → Vendor Dashboard

5. Test Workflows:
   - Create new requests as FO
   - Approve/Reject as RH
   - Approve/Reject as Payment
   - Assign vendor as Vendor Coordinator
   - Verify audit logs show all actions
*/

export { sampleUsers, sampleRequests };
