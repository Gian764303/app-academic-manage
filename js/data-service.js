import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';

function dashboardRef(uid) {
  return doc(db, 'users', uid, 'dashboard', 'main');
}

function pushTokenRef(uid, tokenId) {
  return doc(db, 'users', uid, 'pushTokens', tokenId);
}

function tokenDocId(token) {
  return token.replace(/\//g, '_').replace(/\+/g, '-');
}

export async function savePushToken(uid, token, meta = {}) {
  const id = tokenDocId(token);
  await setDoc(
    pushTokenRef(uid, id),
    {
      token,
      userAgent: meta.userAgent || '',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function deletePushToken(uid, token) {
  await deleteDoc(pushTokenRef(uid, tokenDocId(token)));
}

export async function fetchUserDashboard(uid) {
  const snap = await getDoc(dashboardRef(uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    courses: data.courses || [],
    schedule: data.schedule || {},
    activities: data.activities || [],
    activityHistory: data.activityHistory || [],
    settings: data.settings || {},
  };
}

export async function saveUserDashboard(uid, state) {
  await setDoc(
    dashboardRef(uid),
    {
      courses: state.courses || [],
      schedule: state.schedule || {},
      activities: state.activities || [],
      activityHistory: state.activityHistory || [],
      settings: state.settings || {},
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
