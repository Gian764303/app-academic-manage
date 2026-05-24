import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';

export function bookRef(uid, courseId) {
  return doc(db, 'users', uid, 'books', String(courseId));
}

export async function fetchBook(uid, courseId) {
  const snap = await getDoc(bookRef(uid, courseId));
  if (!snap.exists()) return null;
  return snap.data();
}

export async function saveBook(uid, courseId, payload) {
  await setDoc(
    bookRef(uid, courseId),
    {
      ...payload,
      courseId: String(courseId),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function subscribeBook(uid, courseId, onData, onError) {
  return onSnapshot(
    bookRef(uid, courseId),
    (snap) => {
      onData(snap.exists() ? snap.data() : null);
    },
    onError
  );
}

export async function listBooks(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'books'));
  const books = new Map();
  snap.forEach((d) => books.set(d.id, d.data()));
  return books;
}
