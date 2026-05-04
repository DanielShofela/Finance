/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  initializeApp 
} from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = async () => {
  try {
    // On tente d'abord le popup (meilleure UX sur desktop)
    await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    // Si le popup est bloqué (fréquent sur mobile) ou si on est sur mobile, on bascule sur redirect
    if (error.code === 'auth/popup-blocked' || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      await signInWithRedirect(auth, googleProvider);
    } else {
      console.error("Error signing in with Google", error);
      throw error;
    }
  }
};

export const handleRedirectResponse = async () => {
  try {
    return await getRedirectResult(auth);
  } catch (error) {
    console.error("Error handling redirect result", error);
    return null;
  }
};

export const logout = () => auth.signOut();
