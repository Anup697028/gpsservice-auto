# 🚀 Firebase Cloud Functions Setup Guide

## Prerequisites
- Firebase CLI installed: `npm install -g firebase-tools`
- Firebase project with Blaze plan (pay-as-you-go) for Cloud Functions

## Step 1: Install Dependencies
```powershell
cd functions
npm install
```

## Step 2: Configure SMTP Settings

### Option A: Using Gmail
1. Enable 2-factor authentication on your Gmail account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Run:
```powershell
firebase functions:config:set smtp.host="smtp.gmail.com" smtp.port="587" smtp.user="your-email@gmail.com" smtp.pass="your-16-digit-app-password" smtp.from="no-reply@yourdomain.com"
```

### Option B: Using SendGrid
```powershell
firebase functions:config:set smtp.host="smtp.sendgrid.net" smtp.port="587" smtp.user="apikey" smtp.pass="your-sendgrid-api-key" smtp.from="no-reply@yourdomain.com"
```

## Step 3: Configure Vendor Emails
```powershell
firebase functions:config:set vendors.fleetx="fleetx@vendor.com" vendors.wheelseye="wheelseye@vendor.com"
```

## Step 4: Build Functions
```powershell
npm run build
```

## Step 5: Deploy to Firebase
```powershell
firebase deploy --only functions
```

## Local Testing with Emulators

### Start Emulators
```powershell
firebase emulators:start
```

### Update .env.local
Create a `.env.local` file in the root:
```
VITE_USE_EMULATORS=true
```

### Access Emulator UI
Open http://localhost:4000 to see the Firebase Emulator UI

## Development Mode (No Functions Required)

The app works in dev mode without deployed functions:
- OTP emails are logged to console instead of sent
- Vendor notifications are logged to console
- Perfect for UI development and testing

## Verify Configuration
```powershell
firebase functions:config:get
```

## Troubleshooting

### CORS Errors
The functions include CORS support. If you still see errors:
1. Redeploy functions: `firebase deploy --only functions`
2. Clear browser cache
3. Verify your Firebase project allows the domain

### Function Not Found
1. Verify deployment: `firebase functions:list`
2. Check function logs: `firebase functions:log`
3. Ensure billing is enabled on your Firebase project

### SMTP Errors
1. Verify config: `firebase functions:config:get`
2. Test SMTP credentials using a tool like https://www.smtper.net
3. Check function logs for detailed errors
