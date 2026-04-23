# 🔑 Gmail SMTP Configuration for Real OTP Emails

## ✅ Updated Configuration

**Email**: your-email@gmail.com  
**App Password**: [REDACTED - store in local env only]  
**SMTP Host**: smtp.gmail.com  
**Port**: 587

## 📝 Files Updated

1. **`functions/.env`** - Contains SMTP credentials for Functions emulator
2. **`functions/.env.production`** - Same credentials for production deployment

## 🚀 To Deploy and Enable Real OTPs

Since you don't have deployment permissions, ask your **Firebase project owner** or **admin** to run:

```powershell
cd c:\Users\HP\gps
firebase deploy --only functions
```

This will deploy the Cloud Functions with your Gmail SMTP credentials.

## 🧪 Current Status

- ✅ **SMTP Credentials**: Configured via local/secure environment
- ✅ **Bypass Code**: Working (123456) for development testing
- ⏳ **Real OTPs**: Pending deployment by admin

Once deployed, OTPs will be sent to **any email address** from your configured sender account.

## 🔧 Alternative: Test Locally with Emulator

If you want to test real emails NOW without deploying:

```powershell
# Install Java (required for Firebase emulators)
# Then run:
firebase emulators:start --only functions

# Update .env.local:
# VITE_USE_EMULATORS=true

# Restart dev server
npm run dev
```

This sends **real emails** locally without needing Firebase deployment permissions!
