import {
  collection,
  doc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';

let inboxUnsub = null;
let currentUid = null;
let notifications = [];

function notifCol(uid) {
  return collection(db, 'users', uid, 'notifications');
}

function formatNotifTime(ts) {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  return d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function openActivitiesPanel() {
  document.getElementById('panel-actividades')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (window.location.hash !== '#actividades') {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#actividades`);
  }
}

function updateBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const unread = notifications.filter((n) => !n.read).length;
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderInboxList() {
  const listEl = document.getElementById('notif-inbox-list');
  const emptyEl = document.getElementById('notif-inbox-empty');
  if (!listEl) return;

  if (!notifications.length) {
    listEl.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');
  listEl.innerHTML = notifications.map((n) => `
    <div class="notif-inbox-item ${n.read ? 'notif-inbox-item--read' : ''}" data-id="${escapeHtml(n.id)}">
      <button type="button" class="notif-inbox-item-main" data-action="open" data-id="${escapeHtml(n.id)}">
        <span class="notif-inbox-item-title">${escapeHtml(n.title)}</span>
        <span class="notif-inbox-item-body">${escapeHtml(n.body)}</span>
        <span class="notif-inbox-item-time">${formatNotifTime(n.createdAt)}</span>
      </button>
      <button type="button" class="notif-inbox-item-delete" data-action="delete" data-id="${escapeHtml(n.id)}" aria-label="Eliminar">✕</button>
    </div>
  `).join('');

  updateBadge();
}

function isMobileInbox() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function positionInboxPanelDesktop() {
  const btn = document.getElementById('btn-notif-bell');
  const panel = document.getElementById('notif-inbox-panel');
  if (!btn || !panel || isMobileInbox()) return;

  const rect = btn.getBoundingClientRect();
  panel.style.setProperty('--notif-panel-top', `${rect.bottom + 8}px`);
  panel.style.setProperty('--notif-panel-right', `${Math.max(8, window.innerWidth - rect.right)}px`);
}

let inboxOpenedAt = 0;
let backdropPointerTimer = null;

function setInboxBackdrop(open) {
  const backdrop = document.getElementById('notif-inbox-backdrop');
  if (!backdrop) return;

  if (backdropPointerTimer) {
    clearTimeout(backdropPointerTimer);
    backdropPointerTimer = null;
  }

  if (open && isMobileInbox()) {
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('notif-inbox-backdrop--no-pointer');
    backdropPointerTimer = setTimeout(() => {
      backdrop.classList.remove('notif-inbox-backdrop--no-pointer');
      backdropPointerTimer = null;
    }, 450);
    document.body.classList.add('notif-inbox-open');
    return;
  }

  backdrop.classList.add('hidden');
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('notif-inbox-backdrop--no-pointer');
  document.body.classList.remove('notif-inbox-open');
}

function closeInboxPanel() {
  const panel = document.getElementById('notif-inbox-panel');
  panel?.classList.add('hidden');
  panel?.classList.remove('notif-inbox-panel--permission-blocked');
  panel?.setAttribute('aria-hidden', 'true');
  document.getElementById('btn-notif-bell')?.setAttribute('aria-expanded', 'false');
  setInboxBackdrop(false);
}

function ensureInboxOverlayMounted() {
  if (!isMobileInbox()) return;
  const backdrop = document.getElementById('notif-inbox-backdrop');
  const panel = document.getElementById('notif-inbox-panel');
  if (backdrop && backdrop.parentElement !== document.body) {
    document.body.appendChild(backdrop);
  }
  if (panel && panel.parentElement !== document.body) {
    document.body.appendChild(panel);
  }
}

function isNotifPermissionBlocked() {
  if (!('Notification' in window)) return true;
  return Notification.permission === 'denied';
}

function setMobileBlockedFocus(active) {
  const panel = document.getElementById('notif-inbox-panel');
  if (!panel || !isMobileInbox()) return;
  panel.classList.toggle('notif-inbox-panel--permission-blocked', active);
}

function showBlockedNotifUI() {
  const statusEl = document.getElementById('act-notif-status');
  const deniedHelp = document.getElementById('act-notif-denied-help');
  const deniedHelpMobile = document.getElementById('act-notif-denied-help-mobile');
  const iosHelp = document.getElementById('act-notif-ios-help');
  if (!statusEl) return;
  statusEl.textContent = 'Permiso bloqueado en el navegador.';
  statusEl.className = 'notif-inbox-settings-desc notif-inbox-settings-desc--blocked';
  deniedHelp?.classList.toggle('hidden', isMobileInbox());
  deniedHelpMobile?.classList.toggle('hidden', !isMobileInbox());
  deniedHelp?.classList.add('notif-inbox-settings-alert--denied');
  deniedHelpMobile?.classList.add('notif-inbox-settings-alert--denied');
  iosHelp?.classList.add('hidden');
  setMobileBlockedFocus(true);
}

function showPendingNotifUI() {
  const statusEl = document.getElementById('act-notif-status');
  const deniedHelp = document.getElementById('act-notif-denied-help');
  const deniedHelpMobile = document.getElementById('act-notif-denied-help-mobile');
  const iosHelp = document.getElementById('act-notif-ios-help');
  if (!statusEl) return;
  statusEl.textContent = 'Acepta el permiso del navegador para recibir avisos 24 h y 4 h antes de una actividad.';
  statusEl.className = 'notif-inbox-settings-desc';
  deniedHelp?.classList.add('hidden');
  deniedHelpMobile?.classList.add('hidden');
  deniedHelp?.classList.remove('notif-inbox-settings-alert--denied');
  deniedHelpMobile?.classList.remove('notif-inbox-settings-alert--denied');
  iosHelp?.classList.add('hidden');
  setMobileBlockedFocus(false);
}

function openInboxPanel() {
  ensureInboxOverlayMounted();

  const panel = document.getElementById('notif-inbox-panel');
  const btn = document.getElementById('btn-notif-bell');
  if (!panel || !btn) return;

  inboxOpenedAt = Date.now();
  positionInboxPanelDesktop();
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden', 'false');
  btn.setAttribute('aria-expanded', 'true');
  setInboxBackdrop(true);
  renderInboxList();

  if (isNotifPermissionBlocked()) {
    showBlockedNotifUI();
    return;
  }

  if (isMobileInbox() && 'Notification' in window && Notification.permission === 'default') {
    showPendingNotifUI();
    return;
  }

  setMobileBlockedFocus(false);
  void syncNotifStatusUI();
}

async function ensurePushRegistered() {
  if (!currentUid || !window.registerActivityPush) return false;
  if (Notification.permission !== 'granted') return false;
  if (window.isPushRegistered?.()) return true;

  const result = await window.registerActivityPush(currentUid);
  if (result.ok) {
    window.showAuthToast?.('Recordatorios activados.', 'success');
    return true;
  }
  return false;
}

async function syncNotifStatusUI() {
  const statusEl = document.getElementById('act-notif-status');
  const deniedHelp = document.getElementById('act-notif-denied-help');
  const iosHelp = document.getElementById('act-notif-ios-help');
  if (!statusEl) return;

  if ('Notification' in window && Notification.permission === 'denied') {
    showBlockedNotifUI();
    return;
  }

  const deniedHelpMobile = document.getElementById('act-notif-denied-help-mobile');
  deniedHelpMobile?.classList.add('hidden');
  deniedHelpMobile?.classList.remove('notif-inbox-settings-alert--denied');

  const support = typeof window.getPushSupportInfo === 'function'
    ? await window.getPushSupportInfo()
    : { ok: true };

  if (!support.ok) {
    statusEl.textContent = support.message || 'Tu navegador no admite avisos push.';
    statusEl.className = 'notif-inbox-settings-desc';
    deniedHelp?.classList.add('hidden');
    deniedHelp?.classList.remove('notif-inbox-settings-alert--denied');
    iosHelp?.classList.toggle('hidden', support.reason !== 'ios-needs-pwa');
    if (isMobileInbox() && support.reason === 'ios-needs-pwa') {
      setMobileBlockedFocus(true);
    }
    return;
  }

  iosHelp?.classList.add('hidden');

  if (!('Notification' in window)) {
    statusEl.textContent = 'Tu navegador no admite notificaciones.';
    statusEl.className = 'notif-inbox-settings-desc';
    deniedHelp?.classList.add('hidden');
    deniedHelp?.classList.remove('notif-inbox-settings-alert--denied');
    return;
  }

  deniedHelp?.classList.add('hidden');
  deniedHelp?.classList.remove('notif-inbox-settings-alert--denied');
  deniedHelpMobile?.classList.add('hidden');
  deniedHelpMobile?.classList.remove('notif-inbox-settings-alert--denied');
  setMobileBlockedFocus(false);

  const active = Notification.permission === 'granted' && window.isPushRegistered?.();

  if (active) {
    statusEl.textContent = 'Activos · aviso 24 h y 4 h antes de una actividad. Cierra sesión para desactivar.';
    statusEl.className = 'notif-inbox-settings-desc notif-inbox-settings-desc--on';
    return;
  }

  statusEl.className = 'notif-inbox-settings-desc';
  statusEl.textContent = Notification.permission === 'granted'
    ? 'Permiso concedido · registrando avisos…'
    : 'Acepta el permiso del navegador para recibir avisos 24 h y 4 h antes de una actividad.';
}

function runBellPermissionFlow() {
  if (isMobileInbox() && isNotifPermissionBlocked()) {
    showBlockedNotifUI();
    return;
  }

  if (!('Notification' in window)) {
    if (isMobileInbox()) showBlockedNotifUI();
    return;
  }

  if (Notification.permission === 'denied') {
    showBlockedNotifUI();
    return;
  }

  if (Notification.permission === 'granted') {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
    void ensurePushRegistered().then(() => syncNotifStatusUI());
    return;
  }

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }

  if (isMobileInbox()) {
    showPendingNotifUI();
  }

  void Notification.requestPermission()
    .then(async (result) => {
      if (result === 'granted') {
        await ensurePushRegistered();
        setMobileBlockedFocus(false);
      } else if (result === 'denied') {
        showBlockedNotifUI();
      }
      await syncNotifStatusUI();
    })
    .catch(() => {
      showBlockedNotifUI();
    });
}

function handleBellActivate() {
  const panel = document.getElementById('notif-inbox-panel');
  if (!panel?.classList.contains('hidden')) {
    closeInboxPanel();
    return;
  }

  openInboxPanel();
  runBellPermissionFlow();
}

function handleBellClick(e) {
  if (isMobileInbox()) return;
  e.preventDefault();
  e.stopPropagation();
  handleBellActivate();
}

function handleBellTouchEnd(e) {
  if (!isMobileInbox()) return;
  e.preventDefault();
  e.stopPropagation();
  handleBellActivate();
}

async function markNotificationRead(uid, id) {
  await updateDoc(doc(db, 'users', uid, 'notifications', id), { read: true });
}

async function deleteNotification(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'notifications', id));
}

async function deleteAllNotifications(uid) {
  if (!notifications.length) return;
  const batch = writeBatch(db);
  notifications.forEach((n) => {
    batch.delete(doc(db, 'users', uid, 'notifications', n.id));
  });
  await batch.commit();
}

async function handleInboxClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn || !currentUid) return;
  const id = btn.dataset.id;
  if (!id) return;

  if (btn.dataset.action === 'delete') {
    event.stopPropagation();
    await deleteNotification(currentUid, id);
    return;
  }

  if (btn.dataset.action === 'open') {
    await markNotificationRead(currentUid, id);
    closeInboxPanel();
    openActivitiesPanel();
  }
}

function bindInboxUI() {
  if (window.__notifInboxBound) return;
  window.__notifInboxBound = true;

  closeInboxPanel();
  ensureInboxOverlayMounted();

  const bellBtn = document.getElementById('btn-notif-bell');
  bellBtn?.addEventListener('click', handleBellClick);
  bellBtn?.addEventListener('touchend', handleBellTouchEnd, { passive: false });

  document.getElementById('btn-notif-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeInboxPanel();
  });

  document.getElementById('notif-inbox-backdrop')?.addEventListener('click', () => {
    if (Date.now() - inboxOpenedAt < 500) return;
    closeInboxPanel();
  });

  document.getElementById('btn-notif-clear-all')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentUid || !notifications.length) return;
    await deleteAllNotifications(currentUid);
  });

  document.getElementById('notif-inbox-list')?.addEventListener('click', handleInboxClick);

  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-inbox-panel');
    const btn = document.getElementById('btn-notif-bell');
    if (!panel || panel.classList.contains('hidden')) return;
    if (isMobileInbox()) return;
    if (panel.contains(e.target) || btn?.contains(e.target)) return;
    closeInboxPanel();
  });

  window.addEventListener('resize', () => {
    const panel = document.getElementById('notif-inbox-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    positionInboxPanelDesktop();
    setInboxBackdrop(true);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeInboxPanel();
  });
}

export function initNotificationInbox(uid) {
  if (!uid) return;
  bindInboxUI();
  currentUid = uid;

  if (inboxUnsub) inboxUnsub();

  const q = query(notifCol(uid), orderBy('createdAt', 'desc'), limit(50));
  inboxUnsub = onSnapshot(q, (snap) => {
    notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateBadge();
    const panel = document.getElementById('notif-inbox-panel');
    if (panel && !panel.classList.contains('hidden')) renderInboxList();
  }, (err) => {
    console.warn('Error bandeja de notificaciones:', err);
  });
}

export function teardownNotificationInbox() {
  if (inboxUnsub) {
    inboxUnsub();
    inboxUnsub = null;
  }
  currentUid = null;
  notifications = [];
  closeInboxPanel();
  updateBadge();
  document.body.classList.remove('notif-inbox-open');
}

window.refreshNotificationInbox = () => updateBadge();
