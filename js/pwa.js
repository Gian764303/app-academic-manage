const SW_PATH = '/sw.js';
const NOTIF_ICON = '/icons/icon-192.png';
const PWA_BANNER_SESSION_DISMISS_KEY = 'pwa-install-banner-dismissed-session';

let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIosDevice() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function isMobileInstallContext() {
  return isMobileViewport() || isIosDevice() || isAndroidDevice();
}

function resolveManualPlatform() {
  if (isIosDevice()) return 'ios';
  if (isAndroidDevice()) return 'android';
  return 'generic';
}

export function isPwaInstalled() {
  return isStandaloneDisplay();
}

export function canInstallPwa() {
  return !!deferredInstallPrompt;
}

function waitForInstallPrompt(maxMs = 3500) {
  if (deferredInstallPrompt) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (deferredInstallPrompt) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= maxMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

function setBannerManualSteps(platform) {
  document.getElementById('pwa-banner-manual-ios')?.classList.toggle('hidden', platform !== 'ios');
  document.getElementById('pwa-banner-manual-android')?.classList.toggle('hidden', platform !== 'android');
  document.getElementById('pwa-banner-manual-generic')?.classList.toggle('hidden', platform !== 'generic');
}

function isInstallBannerDismissedThisSession() {
  return sessionStorage.getItem(PWA_BANNER_SESSION_DISMISS_KEY) === '1';
}

function dismissInstallBannerForSession() {
  sessionStorage.setItem(PWA_BANNER_SESSION_DISMISS_KEY, '1');
  closeInstallBanner();
}

function openInstallBanner(mode) {
  const banner = document.getElementById('pwa-install-banner');
  const titleEl = document.getElementById('pwa-banner-title');
  const descEl = document.getElementById('pwa-banner-desc');
  const installBtn = document.getElementById('btn-pwa-banner-install');
  if (!banner) return;

  const isDirect = mode === 'direct' && canInstallPwa();

  if (titleEl) {
    titleEl.textContent = isDirect ? 'Instala Ekawent' : 'Añadir a pantalla de inicio';
  }
  if (descEl) {
    descEl.textContent = isDirect
      ? 'Acceso rápido desde tu inicio, como una app.'
      : 'Tu navegador no permite instalar automáticamente. Sigue estos pasos:';
  }

  installBtn?.classList.toggle('hidden', !isDirect);
  setBannerManualSteps(isDirect ? null : resolveManualPlatform());
  document.querySelectorAll('.pwa-install-banner-manual').forEach((el) => {
    if (isDirect) el.classList.add('hidden');
  });

  banner.classList.remove('hidden');
  banner.setAttribute('aria-hidden', 'false');
  document.body.classList.add('pwa-install-banner-open');
}

function closeInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  banner?.classList.add('hidden');
  banner?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('pwa-install-banner-open');
}

export async function syncPwaInstallBanner() {
  if (isPwaInstalled()) {
    closeInstallBanner();
    return;
  }

  const dashboard = document.getElementById('dashboard-shell');
  const loggedIn = dashboard && !dashboard.classList.contains('hidden');
  if (!loggedIn || !isMobileInstallContext() || isInstallBannerDismissedThisSession()) {
    closeInstallBanner();
    return;
  }

  await waitForInstallPrompt(2500);
  openInstallBanner(canInstallPwa() ? 'direct' : 'manual');
}

async function getRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  } catch (err) {
    console.warn('No se pudo registrar el service worker:', err);
    return null;
  }
}

async function waitForReadyRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function showPwaNotification(title, body, tag) {
  const reg = await waitForReadyRegistration();
  if (reg) {
    await reg.showNotification(title, {
      body,
      tag: String(tag),
      icon: NOTIF_ICON,
      badge: NOTIF_ICON,
      data: { url: '/?source=notif#actividades', tag: String(tag) },
    });
    return;
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, tag: String(tag), icon: NOTIF_ICON });
  }
}

export async function promptPwaInstall() {
  if (!deferredInstallPrompt) return { ok: false, reason: 'unavailable' };
  try {
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    closeInstallBanner();
    if (outcome === 'accepted') {
      window.showAuthToast?.('Instalada correctamente.', 'success');
    }
    return { ok: outcome === 'accepted', outcome };
  } catch (err) {
    console.warn('PWA install prompt failed:', err);
    deferredInstallPrompt = null;
    openInstallBanner('manual');
    return { ok: false, reason: 'error' };
  }
}

export function syncPwaBanner() {
  void syncPwaInstallBanner();
}

export function syncPwaInstallUI() {
  void syncPwaInstallBanner();
}

function captureInstallPrompt(event) {
  event.preventDefault();
  deferredInstallPrompt = event;
  void syncPwaInstallBanner();
}

export async function initPwa() {
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closeInstallBanner();
    window.showAuthToast?.('Instalada correctamente.', 'success');
  });

  document.getElementById('btn-pwa-banner-install')?.addEventListener('click', () => {
    void promptPwaInstall();
  });

  document.getElementById('btn-pwa-banner-dismiss')?.addEventListener('click', () => {
    dismissInstallBannerForSession();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OPEN_ACTIVITIES') {
        document.getElementById('panel-actividades')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.location.hash !== '#actividades') {
          history.replaceState(null, '', `${window.location.pathname}${window.location.search}#actividades`);
        }
      }
    });

    const reg = await getRegistration();
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }
}

window.showPwaNotification = showPwaNotification;
window.promptPwaInstall = promptPwaInstall;
window.syncPwaInstallUI = syncPwaInstallUI;
window.syncPwaBanner = syncPwaBanner;
window.syncPwaInstallBanner = syncPwaInstallBanner;
window.isPwaInstalled = isPwaInstalled;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt);
}
