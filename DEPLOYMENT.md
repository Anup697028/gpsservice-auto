# GPS Installation Automation - Deployment Guide

## Pre-Deployment Checklist

- [ ] Firebase project created and configured
- [ ] Firestore database initialized
- [ ] Authentication methods enabled (Email/Password)
- [ ] Environment variables configured in `.env.local`
- [ ] Firestore security rules set up
- [ ] Build tested successfully (`npm run build`)
- [ ] All dashboards tested with sample data
- [ ] Mobile responsiveness verified

## Firestore Security Rules

Create these rules in Firebase Console under "Firestore Database" → "Rules":

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection - only accessible by authenticated users
    match /users/{document=**} {
      allow read, write: if request.auth != null;
    }

    // Requests collection - role-based access
    match /requests/{document=**} {
      // Anyone authenticated can read
      allow read: if request.auth != null;
      
      // FO can create requests
      allow create: if request.auth != null && 
                       get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'FO';
      
      // Allow updates for authorized users
      allow update: if request.auth != null;
      
      // Allow delete for admins only
      allow delete: if false; // Implement admin check if needed
    }
  }
}
```

## Firebase Authentication Setup

1. Go to Firebase Console → Authentication
2. Enable "Email/Password" sign-in method
3. Optionally enable other providers (Google, GitHub, etc.)

## Deploying to Firebase Hosting

### 1. Install Firebase CLI
```bash
npm install -g firebase-tools
```

### 2. Login to Firebase
```bash
firebase login
```

### 3. Initialize Firebase in project
```bash
firebase init hosting
```

Select:
- Your Firebase project
- Use `dist` as public directory
- Don't configure rewrites (we have client-side routing)
- Don't overwrite dist/index.html

### 4. Build and Deploy
```bash
npm run build
firebase deploy
```

Your app will be available at: `https://your-project.firebaseapp.com`

## Deploying to Vercel

### 1. Push code to GitHub
```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Deploy to Vercel
- Go to https://vercel.com
- Click "New Project"
- Import your GitHub repository
- Add environment variables:
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - etc.
- Click "Deploy"

## Deploying to Netlify

### 1. Using Netlify CLI
```bash
npm install -g netlify-cli
netlify auth login
```

### 2. Deploy
```bash
npm run build
netlify deploy --prod --dir=dist
```

Or connect your GitHub repository at https://netlify.com

## Production Environment Variables

Create a `.env.production.local` file with your production Firebase credentials:

```env
VITE_FIREBASE_API_KEY=prod_api_key
VITE_FIREBASE_AUTH_DOMAIN=prod_auth_domain
VITE_FIREBASE_PROJECT_ID=prod_project_id
VITE_FIREBASE_STORAGE_BUCKET=prod_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=prod_sender_id
VITE_FIREBASE_APP_ID=prod_app_id
```

## Testing Before Deployment

### 1. Local Testing
```bash
npm run dev
# Test all dashboards and workflows
```

### 2. Production Build Testing
```bash
npm run build
npm run preview
# Test in production-like environment
```

### 3. Test Scenarios
- [ ] User registration with each role
- [ ] Login with valid credentials
- [ ] Access control (role-based routing)
- [ ] FO: Create request with multiple vehicles
- [ ] RH: Approve/Reject requests
- [ ] Payment: Review and approve
- [ ] Vendor: Notify and complete requests
- [ ] Audit logs tracking actions
- [ ] Search and filter functionality
- [ ] Error handling for network failures

## Monitoring and Maintenance

### Firebase Console Monitoring
- Storage usage in Firestore
- Authentication metrics
- Real-time database activity

### Application Monitoring
Consider adding:
- Sentry for error tracking
- Google Analytics for usage metrics
- LogRocket for session replay

### Regular Backups
- Export Firestore data regularly
- Keep backups of Firebase rules
- Document all configuration changes

## Troubleshooting

### Build Errors
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Firebase Connection Issues
- Verify credentials in .env.local
- Check Firestore security rules
- Ensure Firebase project is active
- Check browser console for CORS errors

### Authentication Failures
- Verify email/password authentication is enabled
- Check user exists in Firebase Auth
- Look for error messages in console
- Verify security rules allow access

## Performance Optimization

### Code Splitting
Add to `vite.config.js` for better chunk sizes:
```javascript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor': ['react', 'react-dom'],
        'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore']
      }
    }
  }
}
```

### Image Optimization
- Use WebP format where possible
- Compress images before deployment
- Use responsive images

### Caching Strategy
- Set appropriate cache headers
- Use service workers for offline capability
- Cache static assets

## Costs

Firebase Firestore charges:
- **Reads**: $0.12 per 100,000 reads
- **Writes**: $0.24 per 100,000 writes
- **Deletes**: $0.03 per 100,000 deletes
- **Storage**: $0.18 per GB/month

Optimize to reduce costs:
- Use batch operations
- Implement caching
- Archive old data
- Set up automatic cleanup

## Support & Documentation

- [Firebase Documentation](https://firebase.google.com/docs)
- [Vite Documentation](https://vitejs.dev)
- [React Documentation](https://react.dev)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)

## Post-Deployment

1. Monitor logs for errors
2. Gather user feedback
3. Plan feature improvements
4. Schedule regular updates
5. Keep dependencies updated
