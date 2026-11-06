import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

// Only CISapp can request an Orderapp Admin session; roles in URLs are never trusted.
export const createOrderAdminSession = onCall({ region: 'asia-south1',
  cors: ['https://cisapp-236ab.web.app', 'https://cisapp-236ab.firebaseapp.com', 'http://127.0.0.1:5173', 'http://localhost:5173']
}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to CISapp first.');
  if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data) || Object.keys(request.data).length) {
    throw new HttpsError('invalid-argument', 'No session parameters are accepted.');
  }
  const profile = await getFirestore().doc('users/' + request.auth.uid).get();
  if (!profile.exists || profile.data()?.active !== true || !['Admin', 'admin'].includes(profile.data()?.role)) {
    throw new HttpsError('permission-denied', 'Only an active Admin can open Orderapp Admin.');
  }
  // Uses the existing identity; does not create accounts or change any stored roles.
  const token = await getAuth().createCustomToken(request.auth.uid, { orderappAdmin: true });
  return { token };
});
