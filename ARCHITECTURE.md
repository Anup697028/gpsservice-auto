# GPS Installation Automation System - Architecture Documentation

## System Overview

The GPS Installation Automation System is a comprehensive web application designed to streamline the GPS installation workflow across multiple stakeholders. It utilizes a modern, scalable architecture with React on the frontend and Firebase as the backend infrastructure.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (React + Vite)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   FO Dash    │  │   RH Dash    │  │ Payment Dash │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐                                               │
│  │ Vendor Dash  │                                               │
│  └──────────────┘                                               │
│         ↓                                                        │
│  ┌──────────────────────────────────────┐                      │
│  │    Components Layer                  │                      │
│  │    - StatusBadge, Modal, RequestCard │                      │
│  └──────────────────────────────────────┘                      │
│         ↓                                                        │
│  ┌──────────────────────────────────────┐                      │
│  │    Context Layer (Auth Context)      │                      │
│  │    - User state & role management    │                      │
│  └──────────────────────────────────────┘                      │
│         ↓                                                        │
│  ┌──────────────────────────────────────┐                      │
│  │    Services Layer                    │                      │
│  │    - Firebase, Firestore, APIs       │                      │
│  └──────────────────────────────────────┘                      │
│         ↓                                                        │
└─────────────────────────────────────────────────────────────────┘
         ↓                    HTTPS
         ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Firebase)                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐      ┌──────────────────┐                │
│  │  Authentication │      │    Firestore     │                │
│  │  (Firebase Auth)│      │  - users         │                │
│  │                 │      │  - requests      │                │
│  └─────────────────┘      └──────────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Architecture

### 1. Presentation Layer (React Components)

**Dashboard Pages:**
- `Login.jsx` - Authentication UI
- `FoDashboard.jsx` - Field Operator's interface
- `RhDashboard.jsx` - Regional Head's review interface
- `PaymentDashboard.jsx` - Payment team's verification interface
- `VendorDashboard.jsx` - Vendor coordinator's assignment interface

**Reusable Components:**
- `StatusBadge.jsx` - Status indicator with color coding
- `Modal.jsx` - Dialog component for details and actions
- `RequestCard.jsx` - Reusable request display card
- `AuditLog.jsx` - Action history timeline
- `Button.jsx` - Styled button component
- `Loader.jsx` - Loading spinner
- `Toast.jsx` - Notification system

### 2. Context Layer (State Management)

**AuthContext.jsx**
- Manages authentication state
- Stores user information and role
- Provides login, register, logout functions
- Handles Firebase Auth integration
- Requires wrapping app with `<AuthProvider>`

### 3. Service Layer (Business Logic)

**firebase.js**
- Firebase configuration and initialization
- Exports `auth` and `db` instances
- Environment variable configuration

**requestService.js**
- CRUD operations for requests
- Workflow state transitions
- Batch operations (bulk approve)
- Real-time listeners for live updates
- Functions:
  - `createRequest()` - Create new request
  - `getRequestById()` - Fetch single request
  - `getAllRequests()` - Fetch all requests
  - `getRequestsByStatus()` - Filter by status
  - `approveRequest()` - RH/Payment approval
  - `rejectRequest()` - Reject request
  - `editAndApprove()` - Edit and approve
  - `bulkApprove()` - Approve multiple
  - `notifyVendor()` - Vendor notification
  - `subscribeToRequests()` - Real-time updates

**foApiService.js**
- FO API integration (mock implementation)
- `getVehicles()` - Fetch registered vehicles
- `notifyVendor()` - Simulate vendor notification

### 4. Utilities Layer

**validation.js**
- `validateBulkVehicles()` - Multi-vehicle selection rules
- `validateDriverDetails()` - Driver info validation
- `validateEmail()` - Email format check
- `validatePassword()` - Password strength check

**workflow.js**
- Workflow state constants
- Status color mapping
- Status label formatting
- Permission checks

### 5. Styling Layer

**CSS Modules (Component-specific)**
- `auth.css` - Login/register page
- `button.css` - Button styles
- `badge.css` - Status badges
- `modal.css` - Dialog styling
- `dashboard.css` - Dashboard layouts
- `loader.css` - Spinner animation
- `toast.css` - Notification styles

**Global Styles**
- `globals.css` - CSS variables and base styles
- `App.css` - Imports all component styles

## Data Flow

### Request Creation Flow

```
User (FO) 
   ↓
[Select Vehicles + Add Drivers]
   ↓
[Validation Check]
   ├─ validateBulkVehicles() 
   └─ validateDriverDetails()
   ↓
[Submit Request]
   ↓
requestService.createRequest()
   ↓
Firestore: Add to 'requests' collection
   ├─ Set status: REQUEST_CREATED
   ├─ Add audit log entry
   └─ Store FO uid as createdBy
   ↓
RH + Payment Team notified
```

### Approval Flow

```
RH Reviews Request
   ↓
requestService.approveRequest(id, userId, 'RH')
   ├─ Set rhApproval: true
   └─ Add audit log
   ↓
Payment Team Reviews Request
   ↓
requestService.approveRequest(id, userId, 'PAYMENT')
   ├─ Set paymentApproval: true
   └─ Add audit log
   ↓
Check Both Approved?
   ├─ YES: requestService._updateStatus('VENDOR_COORDINATION')
   └─ NO: Wait for other approval
   ↓
Vendor Coordinator Notified
```

### Vendor Notification Flow

```
Vendor Coordinator Selects Vendor
   ↓
requestService.notifyVendor(id, vendorName, userId)
   ├─ POST /notify-vendor (API call)
   ├─ Update vendorName field
   ├─ Save notificationTimestamp
   ├─ Change status: COMPLETED
   └─ Add audit log: "Vendor Notified: {vendorName}"
   ↓
Request Marked Complete
```

## Database Schema

### Firestore Collections

#### `users` Collection
```
users/
├── {uid}/
│   ├── email: string
│   ├── role: 'FO' | 'RH' | 'PAYMENT' | 'VENDOR'
│   └── createdAt: timestamp
```

#### `requests` Collection
```
requests/
├── {requestId}/
│   ├── id: string (PK)
│   ├── vehicles: Array<{vehicleNumber: string}>
│   ├── city: string
│   ├── clientName: string
│   ├── driverDetails: Array<{
│   │   vehicleNumber: string,
│   │   driverName: string,
│   │   driverNumber: string
│   │ }>
│   ├── status: enum (REQUEST_CREATED | PARALLEL_REVIEW | VENDOR_COORDINATION | COMPLETED | HALTED)
│   ├── rhApproval: boolean
│   ├── paymentApproval: boolean
│   ├── vendorName: string (Fleetx | Wheelseye | null)
│   ├── notificationTimestamp: timestamp | null
│   ├── auditLog: Array<{
│   │   action: string,
│   │   performedBy: string (uid),
│   │   timestamp: timestamp
│   │ }>
│   ├── createdBy: string (uid)
│   └── createdAt: timestamp
```

## Permission Model

### Role-Based Access Control

| Role | Create | Read | Approve | Reject | Edit | Notify |
|------|--------|------|---------|--------|------|--------|
| FO | ✓ | Own | ✗ | ✗ | Own | ✗ |
| RH | ✗ | All | ✓ | ✓ | ✓ | ✗ |
| PAYMENT | ✗ | Parallel | ✓ | ✓ | ✗ | ✗ |
| VENDOR | ✗ | Vendor | ✗ | ✗ | ✗ | ✓ |

### Route Protection

```javascript
Protected Routes:
├── /fo-dashboard → role: 'FO'
├── /rh-dashboard → role: 'RH'
├── /payment-dashboard → role: 'PAYMENT'
└── /vendor-dashboard → role: 'VENDOR'

Public Routes:
├── /login → accessible to all
└── / → redirects to /login
```

## Workflow State Machine

```
REQUEST_CREATED
    ↓
    ├─ RH Approves + Payment Approves
    │           ↓
    │    PARALLEL_REVIEW
    │           ↓
    │    VENDOR_COORDINATION
    │           ↓
    │      COMPLETED
    │
    ├─ RH Rejects → HALTED
    │
    └─ Payment Rejects → HALTED
```

## Business Rules

### Multi-Vehicle Selection
- Only registered vehicles displayed
- Allow multi-select if:
  - All vehicles have SAME city AND
  - All vehicles have SAME clientName
- Error message: "Bulk registration allowed only for same client and same city."

### Parallel Approval
- RH and Payment Team review simultaneously
- Both must approve to proceed
- Either rejection → HALTED state
- No sequential dependency

### Driver Details
- Required for each vehicle
- Must include: vehicleNumber, driverName, driverNumber
- Phone validation (minimum 10 digits)

### Audit Trail
- Every action logged with:
  - Action description
  - User ID performing action
  - Timestamp
- Immutable history for compliance

## Security Considerations

### Authentication
- Firebase Auth with email/password
- Passwords min 6 characters
- Session managed by Firebase
- Automatic logout on token expiry

### Authorization
- Role stored in Firestore `users` document
- Role checked on every protected route
- Firestore security rules enforce role-based access

### Data Protection
- HTTPS for all communications
- Firestore security rules enforcement
- User can only see relevant data
- Audit logs prevent data tampering

### Best Practices
- Environment variables for sensitive config
- No hardcoded credentials
- Regular security rule reviews
- Data encryption in transit
- Implement rate limiting (Firebase rules)

## Scalability Considerations

### Performance
- Real-time listeners for live updates
- Indexed Firestore queries
- Lazy loading for large datasets
- Component memoization where needed

### Database
- Document-based storage (Firestore)
- Array fields for relationships
- Indexed queries optimized
- Batch operations for bulk updates

### Caching
- Browser caching for static assets
- Firebase client SDK caching
- Service Worker for offline support

### Monitoring
- Firestore metrics in Firebase Console
- Error logging (Sentry, LogRocket)
- Performance metrics
- User analytics

## Error Handling

### Client-Side
- Form validation
- Try-catch blocks in async operations
- User-friendly error messages
- Toast notifications for feedback

### Server-Side (Firestore)
- Security rules enforcement
- Transaction rollback on failure
- Audit logging of all changes
- Error response handling

## Testing Strategy

### Unit Tests
- Validation functions
- Utility functions
- Component behavior

### Integration Tests
- Firebase operations
- Auth flow
- Workflow transitions

### E2E Tests
- Complete user workflows
- Role-based access
- Data persistence
- Error scenarios

## Deployment Architecture

### Development
- `npm run dev` - Local development server
- Hot Module Replacement (HMR) enabled
- Mock Firebase for testing

### Production
- `npm run build` - Build to `dist/` folder
- Minified and optimized bundles
- Deployed to Firebase Hosting or Vercel
- Environment variables loaded at runtime

### Environment Management
- `.env.local` for development
- `.env.production.local` for production
- CI/CD integration for deployments

## Monitoring & Maintenance

### Logs
- Firestore audit logs
- Firebase Auth logs
- Browser console logs
- Application error logs

### Metrics
- Request processing time
- User activity volume
- Error rates
- API response times

### Updates
- Regular security patches
- Dependency updates
- Feature improvements
- Bug fixes

## Future Enhancements

1. **Advanced Analytics**
   - Dashboard metrics
   - Performance tracking
   - User behavior analysis

2. **Notifications**
   - Email notifications
   - SMS alerts
   - Push notifications

3. **Integration**
   - Third-party vendor APIs
   - Payment gateway integration
   - GPS tracking system

4. **Mobile App**
   - Native mobile applications
   - Offline capability
   - GPS navigation features

5. **Advanced Features**
   - Multi-language support
   - Advanced reporting
   - Bulk operations
   - Automated workflows

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 |
| Build Tool | Vite |
| Routing | React Router v6 |
| State Management | React Context API |
| Backend | Firebase |
| Database | Cloud Firestore |
| Authentication | Firebase Auth |
| Styling | CSS3 with variables |
| Package Manager | npm |

## References

- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Guide](https://firebase.google.com/docs/firestore)
- [Firebase Auth](https://firebase.google.com/docs/auth)

---

**Last Updated:** February 11, 2026
**Version:** 1.0.0
**Status:** Production Ready
