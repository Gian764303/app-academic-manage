


// auth-firebase.js
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth } from './firebase-config.js';
import { fetchUserDashboard, saveUserDashboard } from './data-service.js';
import { syncPushRegistration, unregisterActivityPush } from './push-service.js';
import { initNotificationInbox, teardownNotificationInbox } from './notification-inbox.js';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let saveDebounceTimer = null;
let currentUid = null;

export function getCurrentUid() {
  return currentUid;
}

window.getCurrentUid = getCurrentUid;

export function debouncedCloudSave(state) {
  if (!currentUid) return;
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try {
      await saveUserDashboard(currentUid, state);
    } catch (err) {
      console.error('Error guardando en Firebase:', err);
      window.showAuthToast?.('No se pudo guardar en la nube. Revisa tu conexión.', 'error');
    }
  }, 600);
}

export async function loadCloudState(uid) {
  return fetchUserDashboard(uid);
}

export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export function logoutUser() {
  return signOut(auth);
}

function setAuthMessage(el, text, type = 'info') {
  if (!el) return;
  el.textContent = text;
  el.className = `text-sm rounded-xl px-4 py-3 ${
    type === 'error'
      ? 'bg-red-950/40 text-red-300 border border-red-900/50'
      : type === 'success'
        ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/50'
        : 'bg-zinc-800/80 text-zinc-300 border border-zinc-700'
  }`;
  el.classList.remove('hidden');
}

function hideAuthMessage(el) {
  el?.classList.add('hidden');
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('opacity-60', loading);
  btn.classList.toggle('pointer-events-none', loading);
}

function isGoogleUser(user) {
  return user.providerData.some((p) => p.providerId === 'google.com');
}

export function initAuthUI() {
  const authScreen = document.getElementById('auth-screen');
  const dashboardShell = document.getElementById('dashboard-shell');
  const authUserBar = document.getElementById('auth-user-bar');
  const authUserEmail = document.getElementById('auth-user-email');
  const authUserPhoto = document.getElementById('auth-user-photo');
  const authMsg = document.getElementById('auth-message');
  const authModal = document.getElementById('auth-modal');

  window.showAuthToast = (text, type) => setAuthMessage(authMsg, text, type);

  function openAuthModal() {
    authModal?.classList.remove('hidden');
    hideAuthMessage(authMsg);
  }

  function closeAuthModal() {
    authModal?.classList.add('hidden');
    hideAuthMessage(authMsg);
  }

  document.getElementById('btn-auth-open')?.addEventListener('click', openAuthModal);
  document.getElementById('auth-modal-close')?.addEventListener('click', closeAuthModal);
  document.getElementById('auth-modal-backdrop')?.addEventListener('click', closeAuthModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModal && !authModal.classList.contains('hidden')) {
      closeAuthModal();
    }
  });

  document.getElementById('btn-google-login')?.addEventListener('click', async () => {
    hideAuthMessage(authMsg);
    const btn = document.getElementById('btn-google-login');
    setLoading(btn, true);
    try {
      await loginWithGoogle();
      closeAuthModal();
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') return;
      setAuthMessage(authMsg, translateAuthError(err), 'error');
    } finally {
      setLoading(btn, false);
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    const uid = currentUid;
    if (uid) await unregisterActivityPush(uid);
    await logoutUser();
  });

  onAuthStateChanged(auth, async (user) => {
    if (user && (user.emailVerified || isGoogleUser(user))) {
      currentUid = user.uid;
      window.saveToCloud = (state) => debouncedCloudSave(state);
      window.loadFromCloud = () => loadCloudState(user.uid);
      authScreen?.classList.add('hidden');
      dashboardShell?.classList.remove('hidden');
      authUserBar?.classList.remove('hidden');
      const label = user.displayName || user.email || 'Usuario';
      if (authUserEmail) authUserEmail.textContent = label;
      if (authUserPhoto) {
        if (user.photoURL) {
          authUserPhoto.src = user.photoURL;
          authUserPhoto.alt = label;
          authUserPhoto.classList.remove('hidden');
        } else {
          authUserPhoto.classList.add('hidden');
        }
      }
      if (typeof window.bootstrapDashboard === 'function') {
        await window.bootstrapDashboard();
      }
      await syncPushRegistration(user.uid);
      initNotificationInbox(user.uid);
    } else {
      teardownNotificationInbox();
      const uid = currentUid;
      if (uid) await unregisterActivityPush(uid);
      currentUid = null;
      window.saveToCloud = null;
      window.loadFromCloud = null;
      window.resetDashboardSession?.();
      closeAuthModal();
      authScreen?.classList.remove('hidden');
      dashboardShell?.classList.add('hidden');
      authUserBar?.classList.add('hidden');
      if (user) await signOut(auth);
    }
  });
}

function translateAuthError(err) {
  const map = {
    'auth/popup-blocked': 'El navegador bloqueó la ventana. Permite ventanas emergentes e intenta de nuevo.',
    'auth/cancelled-popup-request': 'Espera a que termine el inicio de sesión anterior.',
    'auth/account-exists-with-different-credential': 'Este correo ya está registrado con otro método.',
    'auth/operation-not-allowed': 'Google no está activado en Firebase. Actívalo en Authentication → Sign-in method.',
    'auth/unauthorized-domain': 'Este dominio no está autorizado. Agrégalo en Firebase → Authentication → Settings.',
  };
  return map[err.code] || err.message || 'No se pudo iniciar sesión con Google.';
}

