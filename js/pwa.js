const SW_PATH = '/sw.js';
const NOTIF_ICON = '/icons/icon-192.svg';
const PWA_BANNER_DISMISS_KEY = 'pwa-install-banner-dismissed';

let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIosSafariInstallable() {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIos && !isStandaloneDisplay();
}

function isBannerDismissed() {
  return localStorage.getItem(PWA_BANNER_DISMISS_KEY) === '1';
}

function dismissPwaBanner() {
  localStorage.setItem(PWA_BANNER_DISMISS_KEY, '1');
  syncPwaBanner();
}

export function isPwaInstalled() {
  return isStandaloneDisplay();
}

export function canInstallPwa() {
  return !!deferredInstallPrompt;
}

export function canShowMobileInstall() {
  if (isPwaInstalled()) return false;
  return canInstallPwa() || isIosSafariInstallable();
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function openMobileInstallSheet() {
  const backdrop = document.getElementById('mobile-install-backdrop');
  const sheet = document.getElementById('mobile-install-sheet');
  if (!backdrop || !sheet) return;
  backdrop.classList.remove('hidden');
  sheet.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('mobile-install-open');
}

function closeMobileInstallSheet() {
  const backdrop = document.getElementById('mobile-install-backdrop');
  const sheet = document.getElementById('mobile-install-sheet');
  backdrop?.classList.add('hidden');
  sheet?.classList.add('hidden');
  backdrop?.setAttribute('aria-hidden', 'true');
  sheet?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('mobile-install-open');
}

export function syncMobileInstallBtn() {
  const btn = document.getElementById('btn-mobile-install');
  if (!btn) return;
  const dashboard = document.getElementById('dashboard-shell');
  const loggedIn = dashboard && !dashboard.classList.contains('hidden');
  const show = loggedIn && isMobileViewport() && canShowMobileInstall();
  btn.classList.toggle('hidden', !show);
}

async function handleMobileInstallClick() {
  if (canInstallPwa()) {
    const result = await promptPwaInstall();
    if (result.ok) return;
    if (isIosSafariInstallable()) {
      openMobileInstallSheet();
    } else {
      window.showAuthToast?.('Tu navegador no permite instalar desde aquí. Usa el menú del navegador.', 'info');
    }
    return;
  }

  if (isIosSafariInstallable()) {
    openMobileInstallSheet();
  }
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
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  syncPwaInstallUI();
  syncPwaBanner();
  return { ok: outcome === 'accepted', outcome };
}

export function syncPwaBanner() {
  const banner = document.getElementById('pwa-install-banner');
  const installBtn = document.getElementById('btn-pwa-banner-install');
  const descEl = document.getElementById('pwa-banner-desc');
  syncMobileInstallBtn();
  if (!banner) return;

  const dashboard = document.getElementById('dashboard-shell');
  const loggedIn = dashboard && !dashboard.classList.contains('hidden');

  if (!loggedIn || isPwaInstalled() || isBannerDismissed()) {
    banner.classList.add('hidden');
    return;
  }

  if (isMobileViewport() && canShowMobileInstall()) {
    banner.classList.add('hidden');
    return;
  }

  if (canInstallPwa()) {
    banner.classList.remove('hidden');
    installBtn?.classList.remove('hidden');
    if (descEl) {
      descEl.textContent = 'Acceso rápido desde tu inicio.';
    }
    return;
  }

  if (isIosSafariInstallable()) {
    banner.classList.remove('hidden');
    installBtn?.classList.add('hidden');
    if (descEl) {
      descEl.textContent = 'En Safari: Compartir → “Añadir a pantalla de inicio”.';
    }
    return;
  }

  banner.classList.add('hidden');
}

export function syncPwaInstallUI() {
  const statusEl = document.getElementById('pwa-install-status');
  const installBtn = document.getElementById('btn-pwa-install');
  const installedInfo = document.getElementById('pwa-installed-info');
  if (!statusEl) {
    syncPwaBanner();
    return;
  }

  if (isPwaInstalled()) {
    statusEl.textContent = 'App instalada';
    statusEl.className = 'text-sm font-medium text-emerald-400';
    installBtn?.classList.add('hidden');
    installedInfo?.classList.remove('hidden');
    syncPwaBanner();
    return;
  }

  installedInfo?.classList.add('hidden');
  statusEl.className = 'text-sm text-zinc-300 leading-relaxed';

  if (canInstallPwa()) {
    statusEl.textContent = 'Instala la app para abrirla desde tu inicio.';
    installBtn?.classList.remove('hidden');
    syncPwaBanner();
    return;
  }

  statusEl.textContent = 'En Chrome/Edge: menú del navegador → “Instalar app” o “Agregar a pantalla de inicio”.';
  installBtn?.classList.add('hidden');
  syncPwaBanner();
}

export async function initPwa() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    syncPwaInstallUI();
    syncPwaBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    syncPwaInstallUI();
    syncPwaBanner();
    syncMobileInstallBtn();
    closeMobileInstallSheet();
    window.showAuthToast?.('Instalada correctamente.', 'success');
  });

  document.getElementById('btn-pwa-banner-install')?.addEventListener('click', () => {
    promptPwaInstall();
  });

  document.getElementById('btn-mobile-install')?.addEventListener('click', () => {
    void handleMobileInstallClick();
  });

  document.getElementById('btn-mobile-install-close')?.addEventListener('click', () => {
    closeMobileInstallSheet();
  });

  document.getElementById('mobile-install-backdrop')?.addEventListener('click', () => {
    closeMobileInstallSheet();
  });

  window.addEventListener('resize', () => {
    syncMobileInstallBtn();
    syncPwaBanner();
  });

  document.getElementById('btn-pwa-banner-dismiss')?.addEventListener('click', () => {
    dismissPwaBanner();
  });

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

  syncPwaInstallUI();
  syncPwaBanner();
  syncMobileInstallBtn();
}

window.showPwaNotification = showPwaNotification;
window.promptPwaInstall = promptPwaInstall;
window.syncPwaInstallUI = syncPwaInstallUI;
window.syncPwaBanner = syncPwaBanner;
window.syncMobileInstallBtn = syncMobileInstallBtn;
window.isPwaInstalled = isPwaInstalled;
