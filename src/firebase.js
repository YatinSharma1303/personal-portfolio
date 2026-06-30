// Firebase init. Keys come from Vite env vars (set in .env / Vercel).
// The web apiKey is public by design — your data is protected by Firestore Rules.
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(cfg.apiKey && cfg.projectId);

let app = null, db = null, auth = null, googleProvider = null;
if (firebaseEnabled) {
  app = initializeApp(cfg);
  db = getFirestore(app);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
}

export { db, auth, googleProvider };
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'yatinsharma1303@gmail.com';
