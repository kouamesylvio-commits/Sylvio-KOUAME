// Point d'entrée regroupant les fonctions Firebase utilisées par js/cloud.js.
// Regénérer js/vendor/firebase.js avec : npm run build:firebase
export { initializeApp } from 'firebase/app';
export {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, signOut, browserLocalPersistence, indexedDBLocalPersistence, initializeAuth,
} from 'firebase/auth';
export {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDoc, getDocFromServer, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot,
  arrayUnion, deleteField, serverTimestamp,
} from 'firebase/firestore';
