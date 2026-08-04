import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

initializeApp();

const db = getFirestore();
const adminAuth = getAuth();
const REGION = 'asia-south1';

const getAdmin = async (uid?: string) => {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in before performing this Admin action.');
  const profile = await db.doc(`users/${uid}`).get();
  if (!profile.exists || profile.data()?.active !== true || profile.data()?.role !== 'Admin') {
    throw new HttpsError('permission-denied', 'Only an active Admin can perform this action.');
  }
};

const requiredString = (value: unknown, label: string, maxLength = 500) => {
  const clean = String(value || '').trim();
  if (!clean) throw new HttpsError('invalid-argument', `${label} is required.`);
  if (clean.length > maxLength) throw new HttpsError('invalid-argument', `${label} is too long.`);
  return clean;
};

export const deleteManagedUser = onCall({ region: REGION }, async (request) => {
  await getAdmin(request.auth?.uid);

  const profileId = requiredString(request.data?.profileId, 'User profile', 160);
  const uid = requiredString(request.data?.uid, 'User UID', 160);

  if (profileId.includes('/') || uid.includes('/')) {
    throw new HttpsError('invalid-argument', 'User identifiers are invalid.');
  }

  if (uid === request.auth?.uid) {
    throw new HttpsError('failed-precondition', 'You cannot delete your own active Admin account.');
  }

  const profileRef = db.collection('users').doc(profileId);
  const profile = await profileRef.get();

  if (!profile.exists || profile.data()?.uid !== uid) {
    throw new HttpsError('not-found', 'The selected user profile was not found.');
  }

  await profileRef.update({
    active: false,
    updatedAt: new Date().toISOString()
  });

  try {
    await adminAuth.deleteUser(uid);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';

    if (code !== 'auth/user-not-found') {
      logger.error('Unable to delete Firebase Auth user.', { uid, error });
      throw new HttpsError('internal', 'Unable to delete the login credentials. Please retry.');
    }
  }

  await profileRef.delete();
  return { ok: true };
});
