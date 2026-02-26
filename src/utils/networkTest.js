import { auth } from '../services/firebase';

export const testFirebaseConnectivity = async () => {
  const results = {
    authDomain: null,
    identitytoolkitReachable: false,
    secureTokenReachable: false,
    error: null,
  };

  try {
    // Get auth domain
    results.authDomain = auth.config.authDomain;
    
    // Test Identity Toolkit (used for authentication)
    const identityUrl = `https://identitytoolkit.googleapis.com/v1/projects/${auth.config.projectId}`;
    try {
      const response = await fetch(identityUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      results.identitytoolkitReachable = response.status !== 0;
    } catch (e) {
      console.error('Identity Toolkit unreachable:', e);
    }

    // Test Secure Token (used for token refresh)
    const secureTokenUrl = 'https://securetoken.googleapis.com/';
    try {
      const response = await fetch(secureTokenUrl, {
        method: 'GET',
        mode: 'no-cors', // Allow cross-origin
      });
      results.secureTokenReachable = true; // If no error, it's reachable
    } catch (e) {
      console.error('Secure Token unreachable:', e);
    }

  } catch (error) {
    results.error = error.message;
  }

  return results;
};

export const logNetworkDiagnostics = async () => {
  console.log('=== Firebase Network Diagnostics ===');
  const results = await testFirebaseConnectivity();
  console.log('Auth Domain:', results.authDomain);
  console.log('Identity Toolkit Reachable:', results.identitytoolkitReachable);
  console.log('Secure Token Reachable:', results.secureTokenReachable);
  
  if (!results.identitytoolkitReachable || !results.secureTokenReachable) {
    console.warn('⚠️ Firebase services may be blocked by firewall/proxy');
    console.warn('Required domains:');
    console.warn('- identitytoolkit.googleapis.com');
    console.warn('- securetoken.googleapis.com');
    console.warn('- firebaseapp.com');
  }
  
  return results;
};
