// Shared Firebase set-up for the menu (customers) and staff.html (counter + owner).
// The web config below is public by design; access is controlled by firestore.rules.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const config = {
  apiKey: 'AIzaSyDXJ883bTiX3l7nrI1bd6xqTWJv9TPzXmI',
  authDomain: 'angaar-pizza-orders.firebaseapp.com',
  projectId: 'angaar-pizza-orders',
  storageBucket: 'angaar-pizza-orders.firebasestorage.app',
  messagingSenderId: '875711398887',
  appId: '1:875711398887:web:d14da0faa61c32a84df342',
};

// On this computer (localhost) everything talks to the local emulators, never the live database.
export const EMU = ['localhost', '127.0.0.1'].includes(location.hostname);

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (EMU) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// A second app instance lets the owner create staff logins without being signed out.
export function secondaryAuth() {
  const a = getAuth(initializeApp(config, 'staff-' + Date.now()));
  if (EMU) connectAuthEmulator(a, 'http://127.0.0.1:9099', { disableWarnings: true });
  return a;
}

export const STATUS = ['new', 'accepted', 'ready', 'served'];
