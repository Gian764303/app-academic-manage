


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

function setUserAvatar(photoEl, fallbackEl, photoURL, label) {
  const initial = (label || '?').charAt(0).toUpperCase();
  if (fallbackEl) fallbackEl.textContent = initial;

  if (!photoEl) {
    if (fallbackEl) fallbackEl.hidden = false;
    return;
  }

  if (!photoURL) {
    photoEl.hidden = true;
    photoEl.removeAttribute('src');
    if (fallbackEl) fallbackEl.hidden = false;
    return;
  }

  photoEl.alt = label;
  photoEl.hidden = true;
  if (fallbackEl) fallbackEl.hidden = false;

  photoEl.onload = () => {
    photoEl.hidden = false;
    if (fallbackEl) fallbackEl.hidden = true;
  };
  photoEl.onerror = () => {
    photoEl.hidden = true;
    if (fallbackEl) fallbackEl.hidden = false;
  };

  photoEl.src = photoURL;
  if (photoEl.complete && photoEl.naturalWidth > 0) {
    photoEl.hidden = false;
    if (fallbackEl) fallbackEl.hidden = true;
  }
}

function initAccountMenu() {
  const trigger = document.getElementById('btn-auth-account');
  const menu = document.getElementById('auth-account-menu');
  const backdrop = document.getElementById('auth-account-backdrop');
  if (!trigger || !menu || !backdrop) return;

  function positionMenu() {
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 240;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12));
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${left}px`;
  }

  function closeAccountMenu() {
    menu.classList.add('hidden');
    backdrop.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('auth-account-open');
  }

  function openAccountMenu() {
    positionMenu();
    menu.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    backdrop.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('auth-account-open');
  }

  function toggleAccountMenu() {
    if (menu.classList.contains('hidden')) {
      openAccountMenu();
    } else {
      closeAccountMenu();
    }
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAccountMenu();
  });

  backdrop.addEventListener('click', closeAccountMenu);

  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
      closeAccountMenu();
    }
  });

  window.closeAccountMenu = closeAccountMenu;
}

export function initAuthUI() {
  const authScreen = document.getElementById('auth-screen');
  const dashboardShell = document.getElementById('dashboard-shell');
  const authUserBar = document.getElementById('auth-user-bar');
  const authUserEmail = document.getElementById('auth-user-email');
  const authUserPhoto = document.getElementById('auth-user-photo');
  const authUserPhotoFallback = document.getElementById('auth-user-photo-fallback');
  const authMenuPhoto = document.getElementById('auth-menu-photo');
  const authMenuPhotoFallback = document.getElementById('auth-menu-photo-fallback');
  const authMenuName = document.getElementById('auth-menu-name');
  const authMenuEmail = document.getElementById('auth-menu-email');
  const authMsg = document.getElementById('auth-message');
  const authModal = document.getElementById('auth-modal');

  initAccountMenu();

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
    window.closeAccountMenu?.();
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
      const displayName = user.displayName || '';
      const email = user.email || '';
      const label = displayName || email || 'Usuario';
      if (authUserEmail) authUserEmail.textContent = label;
      if (authMenuName) authMenuName.textContent = label;
      if (authMenuEmail) {
        if (displayName && email && displayName !== email) {
          authMenuEmail.textContent = email;
          authMenuEmail.classList.remove('hidden');
        } else {
          authMenuEmail.textContent = '';
          authMenuEmail.classList.add('hidden');
        }
      }
      setUserAvatar(authUserPhoto, authUserPhotoFallback, user.photoURL, label);
      setUserAvatar(authMenuPhoto, authMenuPhotoFallback, user.photoURL, label);
      if (typeof window.bootstrapDashboard === 'function') {
        await window.bootstrapDashboard();
      }
      window.syncPwaBanner?.();
      window.syncMobileInstallBtn?.();
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
      window.closeAccountMenu?.();
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

