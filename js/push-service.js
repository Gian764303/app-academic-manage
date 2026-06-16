import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';
import { firebaseApp } from './firebase-config.js';
import { FCM_VAPID_KEY } from './fcm-config.js';
import { savePushToken, deletePushToken } from './data-service.js';

const SW_PATH = '/sw.js';
const LOCAL_TOKEN_KEY = 'fcm-token-local';

let messagingInstance = null;
let foregroundListenerBound = false;
let lastRegisteredToken = null;

export function isPushRegistered() {
  return !!lastRegisteredToken || !!localStorage.getItem(LOCAL_TOKEN_KEY);
}

function isIosDevice() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export async function getPushSupportInfo() {
  if (!('Notification' in window)) {
    return { ok: false, reason: 'no-api', message: 'Tu navegador no admite notificaciones.' };
  }
  if (!('serviceWorker' in navigator)) {
    return { ok: false, reason: 'no-sw', message: 'Tu navegador no admite avisos en segundo plano.' };
  }
  if (!(await isSupported())) {
    return { ok: false, reason: 'no-fcm', message: 'Este navegador no admite avisos push.' };
  }
  if (isIosDevice() && !isStandalonePwa()) {
    return {
      ok: false,
      reason: 'ios-needs-pwa',
      message: 'En iPhone/iPad instala la app en tu inicio primero.',
    };
  }
  return { ok: true };
}

async function getMessagingInstance() {
  if (!(await isSupported())) return null;
  if (!messagingInstance) messagingInstance = getMessaging(firebaseApp);

  if (!foregroundListenerBound) {
    foregroundListenerBound = true;
    onMessage(messagingInstance, (payload) => {
      const title = payload.notification?.title || payload.data?.title || 'Ekawent';
      const body = payload.notification?.body || payload.data?.body || '';
      if (typeof window.showPwaNotification === 'function') {
        window.showPwaNotification(title, body, payload.data?.tag || 'act-foreground');
      }
    });
  }
  return messagingInstance;
}

async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (reg) return reg;
  return navigator.serviceWorker.register(SW_PATH, { scope: '/' });
}

export async function registerActivityPush(uid) {
  if (!uid) return { ok: false, reason: 'no-uid' };
  if (Notification.permission !== 'granted') return { ok: false, reason: 'no-permission' };

  try {
    const messaging = await getMessagingInstance();
    if (!messaging) return { ok: false, reason: 'unsupported' };

    const registration = await ensureServiceWorker();
    if (!registration) return { ok: false, reason: 'no-sw' };

    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY.trim(),
      serviceWorkerRegistration: registration,
    });

    if (!token) return { ok: false, reason: 'no-token' };

    await savePushToken(uid, token, {
      userAgent: navigator.userAgent.slice(0, 200),
    });

    lastRegisteredToken = token;
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
    return { ok: true, token };
  } catch (err) {
    console.error('FCM register error:', err);
    return { ok: false, reason: err.code || err.message || 'error' };
  }
}

export async function unregisterActivityPush(uid) {
  const token = lastRegisteredToken || localStorage.getItem(LOCAL_TOKEN_KEY);
  if (uid && token) {
    try {
      await deletePushToken(uid, token);
    } catch (err) {
      console.warn('No se pudo borrar token FCM:', err);
    }
  }
  lastRegisteredToken = null;
  localStorage.removeItem(LOCAL_TOKEN_KEY);
}

export async function syncPushRegistration(uid) {
  if (!uid) return;
  if (Notification.permission !== 'granted') return;
  await registerActivityPush(uid);
}

window.getPushSupportInfo = getPushSupportInfo;

window.registerActivityPush = registerActivityPush;
window.unregisterActivityPush = unregisterActivityPush;
window.isPushRegistered = isPushRegistered;
