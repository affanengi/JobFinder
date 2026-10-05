/**
 * Firebase Client SDK Initialization.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as fbSignOut,
  onAuthStateChanged,
  User 
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDzFzmbgFslNi2AAI1P5Y2PYCLjjfFMmLE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "jobfinder-c88b5.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "jobfinder-c88b5",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "jobfinder-c88b5.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "725628165859",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:725628165859:web:751aeb7e03bb32b0b5afd6"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  fbSignOut,
  onAuthStateChanged,
};
export type { User };
