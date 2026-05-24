import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyCD98W5uFlavAh9ogTHinZoyWS3pE5JF0Y',
  authDomain: 'app-school-c6e40.firebaseapp.com',
  projectId: 'app-school-c6e40',
  storageBucket: 'app-school-c6e40.firebasestorage.app',
  messagingSenderId: '958617733308',
  appId: '1:958617733308:web:4b3e3847466080be0628b9',
  measurementId: 'G-LE170RCGYY',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

isSupported().then((ok) => {
  if (ok) getAnalytics(firebaseApp);
});
