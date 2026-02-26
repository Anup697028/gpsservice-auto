# GPS Installation Automation System

A production-ready web application for automating GPS installation workflow with role-based access control, built with React (Vite) and Firebase.

## 🏗️ Project Overview

This application automates the GPS installation workflow involving multiple stakeholders:

- **Field Operator (FO)**: Creates requests and selects vehicles
- **Regional Head (RH)**: Reviews and approves requests
- **Payment Team**: Verifies driver and vehicle details
- **Vendor Coordinator**: Manages vendor coordination

## ✨ Key Features

- ✅ Role-based access control with Firebase Auth
- ✅ Multi-vehicle registration with validation
- ✅ Parallel approval workflow (RH + Payment Team)
- ✅ Vendor coordination and notification system
- ✅ Real-time audit logging
- ✅ Request search and filtering
- ✅ Responsive dashboard design
- ✅ Toast notifications and error handling

## 🔄 Workflow States

1. **REQUEST_CREATED** - Initial request submission
2. **PARALLEL_REVIEW** - Simultaneous RH + Payment review
3. **VENDOR_COORDINATION** - Vendor assignment and notification
4. **COMPLETED** - Request fully processed
5. **HALTED** - Rejected by RH or Payment

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ and npm
- Firebase account with Firestore and Authentication enabled

### Installation

1. **Install dependencies** (already done):
```bash
npm install
```

2. **Set up Firebase**:
   - Create a Firebase project at https://console.firebase.google.com
   - Enable Firestore Database and Authentication
   - Create a `.env.local` file with your Firebase config:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

3. **Update Firebase config** in `src/services/firebase.js` to use environment variables

4. **Start development server**:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## 📁 Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── AuditLog.jsx
│   ├── Button.jsx
│   ├── Loader.jsx
│   ├── Modal.jsx
│   ├── RequestCard.jsx
│   ├── StatusBadge.jsx
│   └── Toast.jsx
├── context/
│   └── AuthContext.jsx  # Auth state management
├── pages/               # Dashboard pages
│   ├── Login.jsx
│   ├── FoDashboard.jsx
│   ├── RhDashboard.jsx
│   ├── PaymentDashboard.jsx
│   └── VendorDashboard.jsx
├── services/
│   ├── firebase.js      # Firebase initialization
│   ├── requestService.js
│   └── foApiService.js  # FO API integration (mock)
├── styles/              # Component styles
├── utils/
│   ├── validation.js    # Business logic validation
│   └── workflow.js      # Workflow state helpers
├── App.jsx              # Main app with routing
└── main.jsx
```

## 🔐 Authentication & Authorization

The app uses Firebase Authentication with role-based access:

- **Login/Register**: Email and password authentication
- **Role Storage**: User roles stored in Firestore `users` collection
- **Protected Routes**: Dashboard routes protected by role verification

## 📊 Firestore Collections

### `requests` collection:
```javascript
{
  id: string,
  vehicles: [{ vehicleNumber: string }],
  city: string,
  clientName: string,
  driverDetails: [{vehicleNumber, driverName, driverNumber}],
  status: 'REQUEST_CREATED' | 'PARALLEL_REVIEW' | 'VENDOR_COORDINATION' | 'COMPLETED' | 'HALTED',
  rhApproval: boolean,
  paymentApproval: boolean,
  vendorName: string,
  notificationTimestamp: timestamp,
  auditLog: [{action, performedBy, timestamp}],
  createdBy: string,
  createdAt: timestamp
}
```

### `users` collection:
```javascript
{
  email: string,
  role: 'FO' | 'RH' | 'PAYMENT' | 'VENDOR',
  createdAt: timestamp
}
```

## 🎯 Business Logic

### Multi-Vehicle Selection Rules
- Only registered vehicles are shown (from FO API)
- Multi-select allowed only if all vehicles have SAME city and clientName
- Error message: "Bulk registration allowed only for same client and same city."

### Approval Workflow
1. FO submits request (status: REQUEST_CREATED)
2. RH and Payment Team review in parallel
3. If either rejects → status: HALTED
4. If both approve → status: VENDOR_COORDINATION
5. Vendor coordinator selects vendor and notifies
6. Status changes to COMPLETED

## 🎨 Dashboards

### Field Operator Dashboard
- Multi-select vehicles from registered list
- Add multiple drivers with details
- Submit requests with validation
- View all personal requests

### Regional Head Dashboard
- View all pending requests
- Bulk approve functionality
- Actions: Approve, Edit & Approve, Reject
- Search and filter requests

### Payment Team Dashboard
- View PARALLEL_REVIEW stage requests
- Verify driver and vehicle details
- Actions: Approve, Reject

### Vendor Coordinator Dashboard
- View VENDOR_COORDINATION stage requests
- Select vendor (Fleetx, Wheelseye)
- Notify vendor and mark COMPLETED

## 🧪 Mock API

FO API Service provides mock vehicles:
- Simulates GET /api/fo/vehicles
- Returns registered vehicles with city and client info
- Replace with real API calls as needed

## 📦 Build & Deploy

### Development
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

### Preview
```bash
npm run preview
```

## 🔧 Technologies

- **React 18**: UI framework
- **Vite**: Build tool
- **Firebase**: Auth + Firestore
- **React Router**: Routing
- **CSS3**: Styling with variables

## 📝 Key Features Implementation

✅ Firestore CRUD operations
✅ Real-time listeners for dashboards
✅ Audit logging on all actions
✅ Bulk operations (approve multiple)
✅ Form validation with custom rules
✅ Toast notifications
✅ Mobile responsive design
✅ Error handling and loading states

## 🚀 Next Steps

1. Update Firebase credentials in `.env.local`
2. Update `src/services/firebase.js` to use env variables
3. Create Firestore collections:
   - `users` - store user roles
   - `requests` - store GPS installation requests
4. Create Firebase Auth users for testing
5. Set up Firestore security rules
6. Test complete workflow
7. Deploy to Firebase Hosting or Vercel

## 📖 Documentation Files

- Project setup is complete and ready for Firebase integration
- All UI components are implemented with styling
- Business logic and validation rules are in place
- Mock API for vehicle fetching is available
- Modify Firebase config with your credentials to activate

## 💡 Tips

- The app is fully functional with mock data when Firebase is not configured
- To enable real Firebase features, just update the config credentials
- Check browser console for debugging
- Use React DevTools for state inspection
- Mock API has ~500ms delay to simulate network

Start developing with: `npm run dev`
