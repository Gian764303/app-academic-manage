// ─── STATE ───────────────────────────────────────────────────────────────────
const COLORS = [
  { bg: '#1f2937', text: '#fff' }, // Dark Slate Blue
  { bg: '#84cc16', text: '#000' }, // Lime Green
  { bg: '#3b82f6', text: '#fff' }, // Royal Blue
  { bg: '#8b5cf6', text: '#fff' }, // Purple
  { bg: '#ef4444', text: '#fff' }, // Coral Red
  { bg: '#f59e0b', text: '#000' }, // Amber
  { bg: '#f97316', text: '#fff' }, // Orange
  { bg: '#a15016', text: '#fff' }, // Brown
  { bg: '#047857', text: '#fff' }, // Forest Green
  { bg: '#ec4899', text: '#fff' }, // Pink
  { bg: '#06b6d4', text: '#fff' }, // Cyan/Turquoise
  { bg: '#6366f1', text: '#fff' }, // Indigo
  { bg: '#f43f5e', text: '#fff' }, // Rose
  { bg: '#14b8a6', text: '#fff' }, // Teal
  { bg: '#bef264', text: '#000' }, // Pale Green
];

// ─── CLOUDINARY CONFIG ───────────────────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME = 'db3hacpfx';
const CLOUDINARY_UPLOAD_PRESET = 'app-school-img';

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Error al subir imagen a Cloudinary');
  }

  return await res.json();
}

function getCloudinaryOptimizedUrl(publicId, opts = {}) {
  const { width, height, crop = 'fill', gravity = 'auto', quality = 'auto', format = 'auto' } = opts;
  let transforms = `f_${format},q_${quality}`;
  if (width) transforms += `,w_${width}`;
  if (height) transforms += `,h_${height}`;
  transforms += `,c_${crop},g_${gravity}`;
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${transforms}/${publicId}`;
}

/** Misma URL que usan las tarjetas de cursos (GIF e imágenes funcionan igual). */
function buildCloudinaryDisplayUrl(publicId) {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto,w_1400/${publicId}`;
}

/** Estilo background-image idéntico al de las tarjetas de cursos. */
function cloudinaryBackgroundStyle(imageUrl, options = {}) {
  const bg = options.bg ?? '#18181b';
  const position = options.position ?? 'center';
  const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!url) return `background:${bg};`;
  return `background-image:url('${escapeHtml(url)}'); background-size:cover; background-position:${position}; background-color:${bg};`;
}

function getCloudinaryAssetPath(url) {
  const match = url.match(/res\.cloudinary\.com\/[^/]+\/image\/upload\/(.+)$/i);
  if (!match) return null;
  const assetPath = match[1].split('/').filter((seg) => seg && !seg.includes(',')).join('/');
  return assetPath || null;
}

function isValidHeroImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const t = url.trim();
  return t.startsWith('https://') || t.startsWith('http://') || t.startsWith('data:image/');
}

/** Normaliza URLs de Cloudinary al mismo formato que las tarjetas de cursos. */
function normalizeCloudinaryDisplayUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com')) return url;
  const assetPath = getCloudinaryAssetPath(url);
  if (!assetPath) return url;
  return buildCloudinaryDisplayUrl(assetPath);
}

function repairHeroImageUrls() {
  if (!state.settings) return false;
  let changed = false;
  const broken = /f_gif|fl_keep_anim/i;
  const hero = (state.settings.heroImage || '').trim();
  const fb = (state.settings.heroImageFallback || '').trim();

  if (hero && broken.test(hero)) {
    state.settings.heroImage = (fb && !broken.test(fb))
      ? fb
      : normalizeCloudinaryDisplayUrl(hero);
    changed = true;
  }

  if (fb && broken.test(fb)) {
    state.settings.heroImageFallback = normalizeCloudinaryDisplayUrl(fb);
    changed = true;
  }

  return changed;
}

let selectedColor = null;
let currentYear, currentMonth;
let editingCourseId = null;
let editingActivityId = null;
let isUploadingCourseImage = false;
let modalMultiselectMode = false;
let selectedCourseIds = [];
let editingScheduleDay = null;
let editingScheduleIdx = null;

function getDefaultState() {
  const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const schedule = {};
  ALL_DAYS.forEach(d => { schedule[d] = []; });
  return {
    courses: [],
    schedule,
    activities: [],
    activityHistory: [],
    settings: {
      showHora: true,
      showLugar: true,
      showProfesor: true,
      showCorreo: true,
      showTelefono: true,
      showDays: ALL_DAYS,
      customProperties: [],
      calShowTitulo: true,
      calShowCurso: true,
      calShowTipos: true,
      calShowImportancia: true,
      calShowUrgencia: true,
      gradeMin: 10.5,
      heroImage: '',
      heroImagePos: 50,
      heroImageFallback: '',
    },
  };
}

let state = getDefaultState();
let dashboardBootstrapped = false;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function save() {
  try {
    localStorage.setItem('student-dash', JSON.stringify(state));
  } catch (_) { /* quota / private mode */ }
  if (typeof window.saveToCloud === 'function') {
    window.saveToCloud(state);
  }
}

function optimizeCloudinaryUrl(url, targetWidth, targetHeight) {
  if (!url || typeof url !== 'string') return url;

  const match = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);
  if (!match) return url;

  const baseUrl = match[1];
  const path = match[2];

  const segments = path.split('/');
  let publicIdAndVersionSegments = [];

  const firstSegment = segments[0];
  const hasTransformations = firstSegment.includes(',') || firstSegment.includes('_') || firstSegment === 'f_auto' || firstSegment === 'q_auto';

  const startIndex = hasTransformations ? 1 : 0;
  for (let i = startIndex; i < segments.length; i++) {
    publicIdAndVersionSegments.push(segments[i]);
  }

  const publicIdAndVersion = publicIdAndVersionSegments.join('/');

  let transforms = `f_auto,q_auto`;
  if (targetWidth) transforms += `,w_${targetWidth}`;
  if (targetHeight) transforms += `,h_${targetHeight}`;
  transforms += `,c_fill,g_auto`;

  return `${baseUrl}${transforms}/${publicIdAndVersion}`;
}

async function uploadBase64ToCloudinary(base64Str) {
  const response = await fetch(base64Str);
  const blob = await response.blob();
  return await uploadToCloudinary(blob);
}

async function uploadExternalUrlToCloudinary(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Error al descargar la imagen remota (HTTP ${response.status})`);
  const blob = await response.blob();
  return await uploadToCloudinary(blob);
}

async function migrateLegacyImagesToCloudinary() {
  let needsSave = false;

  if (state.courses && Array.isArray(state.courses)) {
    for (let i = 0; i < state.courses.length; i++) {
      const c = state.courses[i];
      if (c.imageUrl) {
        if (c.imageUrl.startsWith('data:image/')) {
          console.log(`Migrando imagen Base64 del curso "${c.title}" a Cloudinary...`);
          try {
            const result = await uploadBase64ToCloudinary(c.imageUrl);
            const optimizedUrl = getCloudinaryOptimizedUrl(result.public_id, { width: 600, height: 450 });
            c.imageUrl = optimizedUrl;
            needsSave = true;
          } catch (err) {
            console.error(`Error al migrar imagen Base64 del curso "${c.title}":`, err);
          }
        } else if (c.imageUrl.includes('firebasestorage.googleapis.com')) {
          console.log(`Migrando imagen de Firebase Storage del curso "${c.title}" a Cloudinary...`);
          try {
            const result = await uploadExternalUrlToCloudinary(c.imageUrl);
            const optimizedUrl = getCloudinaryOptimizedUrl(result.public_id, { width: 600, height: 450 });
            c.imageUrl = optimizedUrl;
            needsSave = true;
          } catch (err) {
            console.error(`Error al migrar imagen de Firebase Storage del curso "${c.title}":`, err);
          }
        }
      }
    }
  }

  if (state.settings && state.settings.heroImage) {
    if (state.settings.heroImage.startsWith('data:image/')) {
      const isGifData = state.settings.heroImage.startsWith('data:image/gif');
      console.log("Migrando banner hero Base64 a Cloudinary...");
      try {
        const result = await uploadBase64ToCloudinary(state.settings.heroImage);
        const optimizedUrl = buildCloudinaryDisplayUrl(result.public_id);
        state.settings.heroImage = result.secure_url || optimizedUrl;
        state.settings.heroImageFallback = optimizedUrl;
        needsSave = true;
      } catch (err) {
        console.error("Error al migrar banner hero de Base64:", err);
      }
    } else if (state.settings.heroImage.includes('firebasestorage.googleapis.com')) {
      console.log("Migrando banner hero de Firebase Storage a Cloudinary...");
      try {
        const result = await uploadExternalUrlToCloudinary(state.settings.heroImage);
        const optimizedUrl = buildCloudinaryDisplayUrl(result.public_id);
        state.settings.heroImage = result.secure_url || optimizedUrl;
        state.settings.heroImageFallback = optimizedUrl;
        needsSave = true;
      } catch (err) {
        console.error("Error al migrar banner hero de Firebase Storage:", err);
      }
    }
  }

  if (needsSave) {
    persistAndSync();
    if (window.showAuthToast) {
      window.showAuthToast('¡Imágenes heredadas migradas y optimizadas en Cloudinary! Tu dashboard ahora cargará muchísimo más rápido. 🚀', 'success');
    }
  }
}

function normalizeState() {
  if (!state.settings) {
    state.settings = {
      showHora: true,
      showLugar: true,
      showProfesor: true,
      showCorreo: true,
      showTelefono: true,
    };
  }
  if (!state.settings.showDays) {
    state.settings.showDays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  }
  if (!state.settings.customProperties) {
    state.settings.customProperties = [];
  }
  const calDefaults = {
    calShowTitulo: true,
    calShowCurso: true,
    calShowTipos: true,
    calShowImportancia: true,
    calShowUrgencia: true,
    heroImage: '',
    heroImagePos: 50,
    heroImageFallback: '',
  };
  Object.keys(calDefaults).forEach(k => {
    if (state.settings[k] === undefined) state.settings[k] = calDefaults[k];
  });
  if (!state.activityHistory) state.activityHistory = [];
  const completadas = state.activities.filter(a => a.done);
  if (completadas.length) {
    const historyIds = new Set(state.activityHistory.map(a => a.id));
    completadas.forEach(a => {
      if (!a.fechaCompletada) a.fechaCompletada = new Date().toISOString().split('T')[0];
      if (!historyIds.has(a.id)) {
        state.activityHistory.push(a);
        historyIds.add(a.id);
      }
    });
    state.activities = state.activities.filter(a => !a.done);
  }
  if (!state.schedule) {
    state.schedule = {};
  }
  const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  ALL_DAYS.forEach(d => {
    if (!state.schedule[d]) {
      state.schedule[d] = [];
    }
  });

  if (state.courses && Array.isArray(state.courses)) {
    state.courses.forEach(c => {
      if (c.imageUrl) {
        c.imageUrl = optimizeCloudinaryUrl(c.imageUrl, 600, 450);
      }
    });
  }
  if (state.settings?.heroImage) {
    if (!isValidHeroImageUrl(state.settings.heroImage)) {
      state.settings.heroImage = '';
      state.settings.heroImageFallback = '';
    }
  }
  if (repairHeroImageUrls()) {
    try {
      localStorage.setItem('student-dash', JSON.stringify(state));
    } catch (_) { /* ignore */ }
  }
}

function applyCloudData(cloudData) {
  if (cloudData && typeof cloudData === 'object') {
    state = { ...getDefaultState(), ...cloudData };
    if (cloudData.settings) state.settings = { ...getDefaultState().settings, ...cloudData.settings };
  } else {
    const legacy = localStorage.getItem('student-dash');
    if (legacy) {
      try {
        state = JSON.parse(legacy);
      } catch (_) {
        state = getDefaultState();
      }
    } else {
      state = getDefaultState();
    }
  }
  normalizeState();
}

async function bootstrapDashboard() {
  const loader = document.getElementById('dashboard-loading');
  loader?.classList.remove('hidden');

  try {
    if (typeof window.loadFromCloud === 'function') {
      const cloudData = await window.loadFromCloud();
      applyCloudData(cloudData);
      await migrateLegacyImagesToCloudinary();
      if (repairHeroImageUrls()) {
        save();
      }
      if (cloudData && localStorage.getItem('student-dash')) {
        localStorage.removeItem('student-dash');
      }
    } else {
      normalizeState();
    }
  } catch (err) {
    console.error('Error cargando datos:', err);
    window.showAuthToast?.('No se pudieron cargar tus datos. Usando plantilla vacía.', 'error');
    state = getDefaultState();
    normalizeState();
  }

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();

  if (!dashboardBootstrapped) {
    renderApp();
    initEmojiPicker();
    initTablaEvaluacion();
    dashboardBootstrapped = true;
  } else {
    syncViews({ modals: false });
  }

  loader?.classList.add('hidden');
  window.syncPwaBanner?.();
  if (window.location.hash === '#actividades') {
    requestAnimationFrame(() => {
      document.getElementById('panel-actividades')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

window.bootstrapDashboard = bootstrapDashboard;
window.resetDashboardSession = () => { dashboardBootstrapped = false; };

let modalVerDiaFecha = null;

function isModalOpen(id) {
  const el = document.getElementById(id);
  return el && !el.classList.contains('hidden');
}

function renombrarCursoReferencias(viejoNombre, nuevoNombre) {
  const viejo = viejoNombre.trim().toUpperCase();
  const nuevo = nuevoNombre.trim();
  for (const dia in state.schedule) {
    state.schedule[dia].forEach(item => {
      if (item.clase && item.clase.trim().toUpperCase() === viejo) item.clase = nuevo;
    });
  }
  const actualizarAct = (act) => {
    if (act.curso && act.curso.trim().toUpperCase() === viejo) act.curso = nuevo;
  };
  state.activities.forEach(actualizarAct);
  state.activityHistory.forEach(actualizarAct);
}

function eliminarReferenciasCurso(nombre) {
  const key = nombre.trim().toUpperCase();
  for (const dia in state.schedule) {
    state.schedule[dia] = state.schedule[dia].filter(
      item => !(item.clase && item.clase.trim().toUpperCase() === key)
    );
  }
  const limpiar = (act) => {
    if (act.curso && act.curso.trim().toUpperCase() === key) act.curso = '';
  };
  state.activities.forEach(limpiar);
  state.activityHistory.forEach(limpiar);
}

function buildScheduleDetailsHtml(course, item) {
  const rows = [];
  if (state.settings.showHora && item.hora) {
    rows.push(`<div class="flex items-center gap-1.5"><span class="text-zinc-500 text-sm">⏰</span> ${escapeHtml(item.hora)}</div>`);
  }
  if (course) {
    if (state.settings.showLugar && course.lugar) {
      rows.push(`<div class="flex items-center gap-1.5"><span class="text-zinc-500 text-sm">📍</span> <span class="truncate block max-w-full">${escapeHtml(course.lugar)}</span></div>`);
    }
    if (state.settings.showProfesor && course.profesor) {
      rows.push(`<div class="flex items-center gap-1.5"><span class="text-zinc-500 text-sm">👨‍🏫</span> <span class="truncate block max-w-full">${escapeHtml(course.profesor)}</span></div>`);
    }
    if (state.settings.showCorreo && course.correo) {
      rows.push(`<div class="flex items-center gap-1.5"><span class="text-zinc-500 text-sm">✉️</span> <a href="mailto:${escapeHtml(course.correo)}" onclick="event.stopPropagation();" class="text-blue-400 hover:underline truncate block max-w-full">${escapeHtml(course.correo)}</a></div>`);
    }
    if (state.settings.showTelefono && course.telefono) {
      rows.push(`<div class="flex items-center gap-1.5"><span class="text-zinc-500 text-sm">📞</span> <a href="tel:${escapeHtml(course.telefono)}" onclick="event.stopPropagation();" class="text-blue-400 hover:underline truncate block max-w-full">${escapeHtml(course.telefono)}</a></div>`);
    }
    if (state.settings.customProperties && Array.isArray(state.settings.customProperties)) {
      state.settings.customProperties.forEach(prop => {
        if (state.settings[prop.key] && course[prop.key]) {
          rows.push(`<div class="flex items-center gap-1.5"><span class="text-zinc-500 text-sm">${prop.emoji}</span> <span class="truncate block max-w-full">${escapeHtml(String(course[prop.key]))}</span></div>`);
        }
      });
    }
  }
  return rows.join('');
}

function refreshOpenModals() {
  if (isModalOpen('modal-ver-cursos')) renderDetailedCoursesList();
  if (isModalOpen('modal-ver-horario')) renderDetailedScheduleList();
  if (isModalOpen('modal-historial')) renderHistorialList();
  if (isModalOpen('modal-ver-dia') && modalVerDiaFecha) {
    const acts = state.activities.filter(a => a.fecha === modalVerDiaFecha);
    abrirModalVerDia(modalVerDiaFecha, acts);
  }
  if (isModalOpen('modal-ajustes-horario')) {
    renderScheduleDaysCheckboxes();
    syncSettingsCheckboxes();
  }
  if (isModalOpen('modal-ajustes-calendario')) syncCalendarSettingsCheckboxes();
  const horSelect = document.getElementById('hor-clase');
  if (isModalOpen('modal-horario') && horSelect) {
    const current = horSelect.value;
    if (!state.courses || state.courses.length === 0) {
      horSelect.innerHTML = `<option value="">(No hay cursos registrados)</option>`;
      horSelect.value = '';
    } else {
      horSelect.innerHTML = state.courses.map(c => `<option value="${c.title}">${c.title}</option>`).join('');
      horSelect.value = state.courses.some(c => c.title === current) ? current : state.courses[0].title;
    }
  }
}

function syncViews(options = {}) {
  const opts = {
    courses: true,
    schedule: true,
    activities: true,
    calendar: true,
    actSelect: true,
    modals: true,
    ...options
  };
  if (opts.courses) renderCourses();
  if (opts.schedule) renderSchedule();
  if (opts.activities) renderActivities();
  if (opts.calendar) renderCalendar();
  if (opts.actSelect) updateActSelect();
  if (opts.modals) refreshOpenModals();
}

function persistAndSync(options) {
  save();
  syncViews(options);
}

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.ceil((d - today) / 86400000);
}

function urgencyTag(days) {
  if (days < 0) return `<span class="text-xs px-2 py-0.5 rounded-lg tag-red">💀 Vencida</span>`;
  if (days === 0) return `<span class="text-xs px-2 py-0.5 rounded-lg tag-red"><span class="text-red-500 font-bold">⚠</span> Hoy</span>`;
  if (days <= 3) return `<span class="text-xs px-2 py-0.5 rounded-lg tag-yellow">🌕 ${days}d</span>`;
  return `<span class="text-xs px-2 py-0.5 rounded-lg tag-green">🍀 ${days}d</span>`;
}
const TIPO_DETAILS = {
  tarea: { emoji: '📝', label: 'Tarea' },
  examen: { emoji: '📋', label: 'Examen' },
  practica: { emoji: '🧪', label: 'Práctica' },
  exposicion: { emoji: '🗣️', label: 'Exposición' },
  parcial: { emoji: '📝', label: 'Parcial' },
  junta: { emoji: '👥', label: 'Junta' },
  producto: { emoji: '📦', label: 'Producto' },
  investigar: { emoji: '🔍', label: 'Investigar' }
};

function typeIcon(t) {
  if (TIPO_DETAILS[t]) return TIPO_DETAILS[t].emoji;
  return { tarea: '📝', examen: '📋', proyecto: '🚀', lab: '🔬' }[t] || '📌';
}
function uid() { return Date.now() + Math.random(); }

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function parseTime12To24(timeStr) {
  if (!timeStr) return '';
  const clean = timeStr.trim().toLowerCase();
  const match12 = clean.match(/^(\d+):(\d+)\s*(am|pm)?$/);
  if (match12) {
    let hrs = parseInt(match12[1], 10);
    const mins = match12[2];
    const ampm = match12[3];
    if (ampm === 'pm' && hrs < 12) hrs += 12;
    if (ampm === 'am' && hrs === 12) hrs = 0;
    return `${hrs.toString().padStart(2, '0')}:${mins}`;
  }
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    let hrs = parseInt(match24[1], 10);
    return `${hrs.toString().padStart(2, '0')}:${match24[2]}`;
  }
  return '';
}

function formatTime12(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return timeStr;
  let hrs = parseInt(parts[0], 10);
  const mins = parts[1];
  const ampm = hrs >= 12 ? 'pm' : 'am';
  hrs = hrs % 12;
  if (hrs === 0) hrs = 12;
  return `${hrs}:${mins} ${ampm}`;
}

function toggleHorDetalles() {
  const container = document.getElementById('hor-detalles-container');
  const icon = document.getElementById('hor-detalles-icon');
  if (!container || !icon) return;
  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    icon.innerHTML = '－';
  } else {
    container.classList.add('hidden');
    icon.innerHTML = '＋';
  }
}

function handleHorClaseChange() {
  const val = document.getElementById('hor-clase').value;
  if (!val) return;
  const c = state.courses.find(x => x.title === val);
  if (c) {
    document.getElementById('hor-nuevo-lugar').value = c.lugar || '';
    document.getElementById('hor-nuevo-profesor').value = c.profesor || '';
    document.getElementById('hor-nuevo-correo').value = c.correo || '';
    const telefonoEl = document.getElementById('hor-nuevo-telefono');
    if (telefonoEl) telefonoEl.value = c.telefono || '';
  }
}

// ─── MODALS ──────────────────────────────────────────────────────────────────
function abrirModal(id, showDetails = null) {
  document.getElementById(id).classList.remove('hidden');
  if (id === 'modal-curso') {
    editingCourseId = null;
    const titleEl = document.getElementById('curso-modal-titulo');
    if (titleEl) titleEl.innerHTML = `<span>🎓</span> Registrar Nuevo Curso`;
    const btnEl = document.getElementById('curso-modal-btn');
    if (btnEl) btnEl.textContent = 'Agregar';
    const detailsContainer = document.getElementById('curso-detalles-container');
    if (detailsContainer) {
      if (showDetails === true) {
        detailsContainer.classList.remove('hidden');
      } else {
        detailsContainer.classList.add('hidden');
      }
    }
    document.getElementById('curso-nombre').value = '';
    document.getElementById('curso-hora').value = '';
    document.getElementById('curso-lugar').value = '';
    document.getElementById('curso-profesor').value = '';
    document.getElementById('curso-correo').value = '';
    document.getElementById('curso-telefono').value = '';
    document.getElementById('curso-emoji').value = '';
    const imageUrlEl = document.getElementById('curso-imagen-url');
    if (imageUrlEl) imageUrlEl.value = '';
    const imageFileEl = document.getElementById('curso-imagen-file');
    if (imageFileEl) imageFileEl.value = '';
    const uploadStatusEl = document.getElementById('curso-upload-status');
    if (uploadStatusEl) uploadStatusEl.classList.add('hidden');
    selectedColor = COLORS[0];
    document.querySelectorAll('.swatch').forEach((b, idx) => {
      if (idx === 0) b.classList.add('selected');
      else b.classList.remove('selected');
    });
    isUploadingCourseImage = false;
    setCourseModalSaveState(true);
  } else if (id === 'modal-ver-cursos') {
    const searchInput = document.getElementById('search-courses');
    if (searchInput) searchInput.value = '';
    modalMultiselectMode = false;
    selectedCourseIds = [];
    renderDetailedCoursesList();
  } else if (id === 'modal-ver-horario') {
    const searchInput = document.getElementById('search-schedule');
    if (searchInput) searchInput.value = '';
    renderDetailedScheduleList();
  } else if (id === 'modal-horario') {
    editingScheduleDay = null;
    editingScheduleIdx = null;
    const titleEl = document.getElementById('hor-modal-titulo');
    if (titleEl) titleEl.innerHTML = `<span>📅</span> Registrar Horario`;
    const selectEl = document.getElementById('hor-clase');
    if (selectEl) {
      if (!state.courses || state.courses.length === 0) {
        selectEl.innerHTML = `<option value="">(No hay cursos registrados)</option>`;
        selectEl.value = '';
      } else {
        selectEl.innerHTML = state.courses.map(c => `<option value="${c.title}">${c.title}</option>`).join('');
        selectEl.value = state.courses[0].title;
      }
    }
    document.getElementById('hor-nuevo-hora-inicio').value = '';
    document.getElementById('hor-nuevo-hora-fin').value = '';
    const detailsContainer = document.getElementById('hor-detalles-container');
    const detailsIcon = document.getElementById('hor-detalles-icon');
    if (detailsContainer) detailsContainer.classList.add('hidden');
    if (detailsIcon) detailsIcon.innerHTML = '＋';
    handleHorClaseChange();
  } else if (id === 'modal-ajustes-horario') {
    renderScheduleDaysCheckboxes();
    syncSettingsCheckboxes();
  } else if (id === 'modal-ajustes-calendario') {
    syncCalendarSettingsCheckboxes();
  } else if (id === 'modal-actividad') {
    if (editingActivityId === null) {
      const titleEl = document.getElementById('modal-actividad-titulo');
      const btnEl = document.getElementById('modal-actividad-btn');
      if (titleEl) titleEl.innerHTML = `<span>📝</span> Nueva Actividad`;
      if (btnEl) btnEl.textContent = 'Agregar';
      updateActSelect();
      selectImportancia('media');
      resetTiposSeleccionados();
      document.getElementById('act-titulo').value = '';
      document.getElementById('act-fecha').value = '';
    }
  } else if (id === 'modal-historial') {
    const search = document.getElementById('search-historial');
    if (search) search.value = '';
    renderHistorialList();
  }
}
function cerrarModal(id) {
  document.getElementById(id).classList.add('hidden');
  cerrarEmojiPicker();
  if (id === 'modal-ver-dia') modalVerDiaFecha = null;
  if (id === 'modal-actividad') {
    editingActivityId = null;
    cerrarPopTipos();
  }
}

function abrirModalConFecha(fecha) {
  editingActivityId = null;
  const titleEl = document.getElementById('modal-actividad-titulo');
  const btnEl = document.getElementById('modal-actividad-btn');
  if (titleEl) titleEl.innerHTML = `<span>📝</span> Nueva Actividad`;
  if (btnEl) btnEl.textContent = 'Agregar';
  abrirModal('modal-actividad');
  document.getElementById('act-fecha').value = fecha;
  resetTiposSeleccionados();
  selectImportancia('media');
  document.getElementById('act-titulo').value = '';
  document.getElementById('act-curso').value = '';
}

function abrirModalVerDiaDesdeCalendario(fecha) {
  const actividades = state.activities.filter(a => a.fecha === fecha);
  abrirModalVerDia(fecha, actividades);
}

function abrirModalVerDia(fecha, actividades) {
  const modal = document.getElementById('modal-ver-dia');
  if (!modal) {
    console.error('Modal modal-ver-dia no encontrado');
    return;
  }
  modalVerDiaFecha = fecha;
  const dateObj = new Date(fecha + 'T00:00:00');
  const fechaFormato = new Intl.DateTimeFormat('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(dateObj);
  document.getElementById('ver-dia-titulo').textContent = fechaFormato.charAt(0).toUpperCase() + fechaFormato.slice(1);
  const listEl = document.getElementById('ver-dia-list');
  let html = '';
  if (!actividades.length) {
    html = '<div class="text-center text-zinc-500 py-8 text-sm">Sin actividades para este día.</div>';
  }
  actividades.forEach(a => {
    const importanciaClass = a.importancia === 'alta' ? 'bg-red-950/30 text-red-400' :
      a.importancia === 'media' ? 'bg-sky-950/30 text-sky-400' :
        'bg-emerald-950/30 text-emerald-400';
    const tiposHtml = a.tipos && a.tipos.length ? `<div class="flex flex-wrap gap-1">${a.tipos.map(t => `<span class="text-sm bg-zinc-700 px-2 py-1 rounded-lg">${t}</span>`).join('')}</div>` : '';
    html += `
    <div class="p-4 bg-[#232323] border border-zinc-700 rounded-xl space-y-2">
      <div class="flex items-center justify-between">
        <h4 class="font-semibold text-white">${a.titulo}</h4>
        <span class="text-xs px-2 py-1 rounded-lg ${importanciaClass}">${a.importancia}</span>
      </div>
      <div class="text-sm text-zinc-400">${a.curso || 'Sin curso'}</div>
      ${tiposHtml}
      <button onclick="abrirEditarActividad(${a.id})" class="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition">Editar</button>
      <div class="flex items-center gap-2 pt-2 border-t border-zinc-800">
        <button type="button" onclick="event.stopPropagation(); marcarActividadHecha(${a.id})" class="act-done-check shrink-0 flex items-center gap-2 group/check" title="Marcar como hecha">
          <span class="act-done-box w-4 h-4 rounded-md border-2 border-zinc-500 flex items-center justify-center group-hover/check:border-emerald-400 transition"></span>
          <span class="text-sm font-semibold text-zinc-400 group-hover/check:text-emerald-400 transition">Hecho</span>
        </button>
      </div>
    </div>
    `;
  });
  html += `
    <button onclick="cerrarModal('modal-ver-dia'); abrirModal('modal-actividad'); document.getElementById('act-fecha').value = '${fecha}'" class="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-medium transition">+ Agregar otra actividad</button>
  `;
  listEl.innerHTML = html;
  modal.classList.remove('hidden');
}

function abrirEditarActividadModal(id) {
  const actividad = state.activities.find(a => a.id === id);
  if (!actividad) return;
  editingActivityId = id;
  const titleEl = document.getElementById('modal-actividad-titulo');
  const btnEl = document.getElementById('modal-actividad-btn');
  if (titleEl) titleEl.innerHTML = `<span>✏️</span> Editar Actividad`;
  if (btnEl) btnEl.textContent = 'Guardar Cambios';
  document.getElementById('act-titulo').value = actividad.titulo || '';
  document.getElementById('act-curso').value = actividad.curso || '';
  document.getElementById('act-fecha').value = actividad.fecha || '';
  document.getElementById('act-importancia').value = actividad.importancia || 'media';
  if (actividad.tipos && actividad.tipos.length > 0) {
    savedTipos = [...actividad.tipos];
    selectedTipos = [...actividad.tipos];
    actualizarTextoTiposSeleccionados();
  } else {
    resetTiposSeleccionados();
  }
  selectImportancia(actividad.importancia || 'media');
  abrirModal('modal-actividad');
}

function abrirEditarActividad(id) {
  cerrarModal('modal-ver-dia');
  abrirEditarActividadModal(id);
}

function abrirEditarClase(day, idx) {
  editingScheduleDay = day;
  editingScheduleIdx = idx;
  const item = state.schedule[day][idx];
  if (!item) return;
  const titleEl = document.getElementById('hor-modal-titulo');
  if (titleEl) titleEl.innerHTML = `<span>📝</span> Editar Clase`;
  const daySelect = document.getElementById('hor-dia');
  if (daySelect) daySelect.value = day;
  const selectEl = document.getElementById('hor-clase');
  if (selectEl) {
    if (!state.courses || state.courses.length === 0) {
      selectEl.innerHTML = `<option value="">(No hay cursos registrados)</option>`;
      selectEl.value = '';
    } else {
      selectEl.innerHTML = state.courses.map(c => `<option value="${c.title}">${c.title}</option>`).join('');
      selectEl.value = state.courses[0].title;
    }
  }
  let startVal = '';
  let endVal = '';
  if (item.hora) {
    const parts = item.hora.split('-');
    if (parts.length >= 1) startVal = parseTime12To24(parts[0]);
    if (parts.length >= 2) endVal = parseTime12To24(parts[1]);
  }
  document.getElementById('hor-nuevo-hora-inicio').value = startVal;
  document.getElementById('hor-nuevo-hora-fin').value = endVal;
  const detailsContainer = document.getElementById('hor-detalles-container');
  const detailsIcon = document.getElementById('hor-detalles-icon');
  if (detailsContainer) detailsContainer.classList.add('hidden');
  if (detailsIcon) detailsIcon.innerHTML = '＋';
  handleHorClaseChange();
  document.getElementById('modal-horario').classList.remove('hidden');
}

// ─── COLOR PICKER ────────────────────────────────────────────────────────────
function setCourseModalSaveState(enabled) {
  const btnEl = document.getElementById('curso-modal-btn');
  if (!btnEl) return;
  btnEl.disabled = !enabled;
  if (!enabled) {
    btnEl.classList.add('opacity-50', 'cursor-not-allowed');
  } else {
    btnEl.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

function renderColorPicker() {
  const el = document.getElementById('color-picker');
  if (!el) return;
  const swatchesHtml = COLORS.map((c, i) => `
    <button type="button" class="swatch w-8 h-8 shrink-0 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer ${i === 0 ? 'selected' : ''}"
      style="background:${c.bg}"
      onclick="selectColor(${i}, this)"></button>
  `).join('');
  const uploadSwatch = `
    <button type="button" class="swatch-upload w-8 h-8 shrink-0 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center leading-none"
      onclick="document.getElementById('curso-imagen-file').click()" title="Subir imagen">
      📁
    </button>
  `;
  el.innerHTML = swatchesHtml + uploadSwatch;
}
function selectColor(i, btn) {
  selectedColor = COLORS[i];
  document.querySelectorAll('.swatch').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const imageUrlEl = document.getElementById('curso-imagen-url');
  if (imageUrlEl) imageUrlEl.value = '';
  const uploadStatusEl = document.getElementById('curso-upload-status');
  if (uploadStatusEl) uploadStatusEl.classList.add('hidden');
}

async function handleCourseImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Selecciona un archivo de imagen válido.');
    event.target.value = '';
    return;
  }
  const statusEl = document.getElementById('curso-upload-status');
  const urlInput = document.getElementById('curso-imagen-url');
  isUploadingCourseImage = true;
  setCourseModalSaveState(false);
  if (statusEl) {
    statusEl.textContent = '⏳ Subiendo imagen.';
    statusEl.classList.remove('hidden');
    statusEl.className = 'text-xs text-blue-400';
  }
  try {
    const result = await uploadToCloudinary(file);
    const optimizedUrl = buildCloudinaryDisplayUrl(result.public_id);
    if (urlInput) urlInput.value = optimizedUrl;
    if (statusEl) {
      statusEl.textContent = '✅ Imagen subida correctamente';
      statusEl.className = 'text-xs text-emerald-400';
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    }
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    if (statusEl) {
      statusEl.textContent = getCloudinaryErrorMessage(err);
      statusEl.className = 'text-xs text-red-400';
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    }
  } finally {
    isUploadingCourseImage = false;
    setCourseModalSaveState(true);
  }
  event.target.value = '';
}

function getCloudinaryErrorMessage(err) {
  const message = err?.message || '';
  if (message.includes('File size too large')) {
    return '❌ Error: Excede el peso límite de 10MB.';
  }
  return `❌ Error: ${message || 'No se pudo subir la imagen.'}`;
}

function agregarCurso() {
  const nombreEl = document.getElementById('curso-nombre');
  const emojiEl = document.getElementById('curso-emoji');
  const imagenDataEl = document.getElementById('curso-imagen-url');
  if (!nombreEl) return;
  const nombre = nombreEl.value.trim();
  if (!nombre) {
    alert('El nombre del curso es requerido.');
    return;
  }
  const emoji = (emojiEl ? emojiEl.value.trim() : '') || '📚';
  const imageUrl = imagenDataEl && imagenDataEl.value ? imagenDataEl.value : '';
  const bg = selectedColor ? selectedColor.bg : '#84cc16';
  const text = selectedColor ? selectedColor.text : '#000';
  if (editingCourseId !== null) {
    const curso = state.courses.find(c => c.id === editingCourseId);
    if (curso) {
      const viejoNombre = curso.title;
      curso.title = nombre;
      curso.emoji = emoji;
      curso.imageUrl = imageUrl;
      curso.bg = bg;
      curso.text = text;
      renombrarCursoReferencias(viejoNombre, nombre);
    }
  } else {
    const nuevoCurso = {
      id: uid(),
      title: nombre,
      emoji: emoji,
      imageUrl: imageUrl,
      bg: bg,
      text: text,
      hidden: false
    };
    state.courses.push(nuevoCurso);
  }
  persistAndSync();
  cerrarModal('modal-curso');
}

function abrirEditarCurso(id) {
  editingCourseId = id;
  const curso = state.courses.find(c => c.id === id);
  if (!curso) return;
  const titleEl = document.getElementById('curso-modal-titulo');
  if (titleEl) titleEl.innerHTML = `<span>📝</span> Editar Curso`;
  const btnEl = document.getElementById('curso-modal-btn');
  if (btnEl) btnEl.textContent = 'Guardar';
  document.getElementById('curso-nombre').value = curso.title || '';
  document.getElementById('curso-emoji').value = curso.emoji || '';
  const imageUrl = curso.imageUrl || '';
  document.getElementById('curso-imagen-url').value = imageUrl;
  const colorIndex = COLORS.findIndex(col => col.bg.toLowerCase() === curso.bg.toLowerCase());
  if (colorIndex !== -1) {
    selectedColor = COLORS[colorIndex];
  } else {
    selectedColor = { bg: curso.bg, text: curso.text };
  }
  document.querySelectorAll('.swatch').forEach((b, idx) => {
    if (idx === colorIndex) b.classList.add('selected');
    else b.classList.remove('selected');
  });
  document.getElementById('modal-curso').classList.remove('hidden');
}

const tablaEvaluacionData = [
  { name: 'Examen Parcial', peso: 25, puntaje: 20 },
  { name: 'Evidencia de Des…', peso: 15, puntaje: 20 },
  { name: 'Evidencia de Des…', peso: 15, puntaje: 20 },
  { name: 'Evidencia de Pro…', peso: 40, puntaje: 20 },
  { name: 'Evidencia de acti…', peso: 5, puntaje: 20 },
];

function abrirCuadernoCurso(id) {
  const curso = state.courses.find(c => c.id === id);
  if (!curso) return;
  const params = new URLSearchParams({
    courseId: String(id),
    title: curso.title || 'Cuaderno',
    emoji: curso.emoji || '📓',
  });
  const bookUrl = new URL('book/book.html', window.location.href);
  bookUrl.search = params.toString();
  window.open(bookUrl.toString(), '_blank', 'noopener,noreferrer');
}

function abrirTodosCuadernos() {
  const url = new URL('book/notebooks.html', window.location.href);
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

function abrirTablaCurso(id) {
  const curso = state.courses.find(c => c.id === id);
  if (!curso) return;
  const modalTitle = document.getElementById('tabla-curso-modal-titulo');
  const wrap = document.querySelector('#modal-tabla-curso .wrap');
  if (!modalTitle || !wrap) return;
  modalTitle.textContent = curso.title || 'Curso';
  wrap.style.width = '100%';
  initTablaEvaluacion();
  const input = document.getElementById('grade-min-input');
  if (input && state.settings) input.value = state.settings.gradeMin ?? 60;
  abrirModal('modal-tabla-curso');
}

function ring(p) {
  const val = Math.min(100, Math.max(0, p));
  const r = 9;
  const circ = 2 * Math.PI * r;
  const filled = circ * (val / 100);
  const offset = circ * 0.25;
  return `<svg width="22" height="22" viewBox="0 0 22 22" style="display:block;flex-shrink:0">
    <circle cx="11" cy="11" r="${r}" fill="none" stroke="#444" stroke-width="2.2"/>
    <circle cx="11" cy="11" r="${r}" fill="none" stroke="#3d8f5f" stroke-width="2.2"
      stroke-dasharray="${filled.toFixed(3)} ${(circ - filled).toFixed(3)}"
      stroke-dashoffset="${offset}" stroke-linecap="round"/>
  </svg>`;
}

function recalcTablaEvaluacion() {
  let sumP = 0;
  let sumW = 0;
  tablaEvaluacionData.forEach(d => { sumP += d.peso; sumW += d.peso * d.puntaje; });
  const rc = document.getElementById('row-count');
  if (rc) {
    rc.textContent = String(tablaEvaluacionData.length);
  }
  const sp = document.getElementById('sum-peso');
  if (sp) {
    sp.textContent = `${sumP}%`;
    sp.className = Math.abs(sumP - 100) > 0.01 ? 'err' : 'text-white';
  }
  const prom = document.getElementById('promedio');
  if (prom) {
    const promedio = sumP > 0 ? (sumW / sumP) : 0;
    const minScore = (state.settings && Number.isFinite(state.settings.gradeMin)) ? state.settings.gradeMin : 60;
    prom.textContent = promedio.toFixed(2);
    prom.style.color = promedio < minScore ? '#f87171' : '#38bdf8';
  }
}

function renderRow(tr, i) {
  const d = tablaEvaluacionData[i] || {};
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : 'Nueva fila';
  const peso = Number.isFinite(d.peso) ? d.peso : 0;
  const puntaje = Number.isFinite(d.puntaje) ? d.puntaje : 0;
  tr.dataset.row = i;
  tr.innerHTML = `
    <td data-row="${i}" data-col="name">
      <div class="name-w"><span>${escapeHtml(name)}</span><span class="name-icon">✏️</span></div>
      <div class="inline-popup" id="popup-${i}"><input id="pinput-${i}"/></div>
    </td>
    <td data-row="${i}" data-col="peso">
      <div class="ring-w"><span>${peso}%</span>${ring(peso)}</div>
    </td>
    <td class="r" data-row="${i}" data-col="puntaje">${puntaje}</td>`;
}

function toggleTablaAjustes() {
  const panel = document.getElementById('tabla-ajustes-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  const input = document.getElementById('grade-min-input');
  if (input && state.settings) input.value = state.settings.gradeMin ?? 60;
}

function actualizarMinimoTabla() {
  const input = document.getElementById('grade-min-input');
  if (!input || !state.settings) return;
  const value = parseFloat(input.value);
  state.settings.gradeMin = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 60;
  input.value = state.settings.gradeMin;
  recalcTablaEvaluacion();
}

function guardarMinimoTabla() {
  actualizarMinimoTabla();
  const panel = document.getElementById('tabla-ajustes-panel');
  if (panel) panel.classList.add('hidden');
  persistAndSync();
  window.showAuthToast?.('Mínimo aprobado guardado.', 'success');
}

function agregarFilaTabla() {
  tablaEvaluacionData.push({ name: '', peso: 0, puntaje: 0 });
  initTablaEvaluacion();
}

function quitarUltimaFilaTabla() {
  if (tablaEvaluacionData.length === 0) return;
  tablaEvaluacionData.pop();
  initTablaEvaluacion();
}

function initTablaEvaluacion() {
  const tb = document.getElementById('rows');
  if (!tb) return;
  tb.innerHTML = '';
  tablaEvaluacionData.forEach((_, i) => {
    const tr = document.createElement('tr');
    renderRow(tr, i);
    tb.appendChild(tr);
  });
  [...tb.rows].forEach((tr, i) => attachListeners(tr, i));
  const rc = document.getElementById('row-count');
  if (rc) {
    rc.textContent = String(tb.rows.length);
  }
  recalcTablaEvaluacion();
}

function closeAllPopups() {
  document.querySelectorAll('.inline-popup').forEach(p => p.style.display = 'none');
}

function openPopup(td, i, col) {
  closeAllPopups();
  const popup = document.getElementById(`popup-${i}`);
  const inp = document.getElementById(`pinput-${i}`);
  if (!popup || !inp) return;
  const trRect = td.closest('tr').getBoundingClientRect();
  const tdRect = td.getBoundingClientRect();
  popup.style.display = 'block';
  popup.style.left = `${tdRect.left - trRect.left}px`;
  popup.style.top = `${tdRect.top - trRect.top}px`;
  popup.style.width = `${tdRect.width}px`;
  popup.style.height = `${tdRect.height}px`;
  inp.type = col === 'name' ? 'text' : 'number';
  inp.className = col === 'name' ? '' : 'num';
  if (col !== 'name') {
    inp.min = 0;
    if (col === 'peso') inp.max = 100;
  }
  inp.value = tablaEvaluacionData[i][col];
  inp.style.height = '100%';
  setTimeout(() => { inp.focus(); inp.select(); }, 10);
  inp.onkeydown = e => {
    if (e.key === 'Enter') commitTablaEvaluacion(i, col, inp);
    if (e.key === 'Escape') closeAllPopups();
  };
  inp.onblur = () => setTimeout(() => commitTablaEvaluacion(i, col, inp), 120);
}

function commitTablaEvaluacion(i, col, inp) {
  let val;
  if (col === 'name') {
    val = inp.value.trim();
    if (!val) {
      val = tablaEvaluacionData[i].name;
    }
  } else {
    val = parseFloat(inp.value);
    if (Number.isNaN(val)) {
      val = tablaEvaluacionData[i][col];
    }
    if (val < 0) val = 0;
    if (col === 'peso') {
      if (val > 100) val = 100;
    } else if (col === 'puntaje') {
      if (val > 20) val = 20;
    }
    val = Number.isFinite(val) ? val : tablaEvaluacionData[i][col];
  }
  tablaEvaluacionData[i][col] = val;
  const tr = document.getElementById('rows').rows[i];
  renderRow(tr, i);
  attachListeners(tr, i);
  recalcTablaEvaluacion();
  closeAllPopups();
}

function attachListeners(tr, i) {
  tr.querySelectorAll('td[data-col]').forEach(td => {
    td.addEventListener('click', () => openPopup(td, +td.dataset.row, td.dataset.col));
  });
}

// ─── COURSES ─────────────────────────────────────────────────────────────────
function eliminarCurso(id) {
  const curso = state.courses.find(c => c.id === id);
  const nombre = curso ? curso.title : '';
  if (confirm(`¿Desea eliminar el curso "${nombre}" permanentemente?`)) {
    if (nombre) eliminarReferenciasCurso(nombre);
    state.courses = state.courses.filter(c => c.id !== id);
    persistAndSync();
    return true;
  }
  return false;
}

function eliminarCursoDesdeModal(id) {
  if (eliminarCurso(id)) {
    renderDetailedCoursesList();
  }
}

function toggleOcultarCurso(id) {
  const curso = state.courses.find(c => c.id === id);
  if (curso) {
    curso.hidden = !curso.hidden;
    persistAndSync();
  }
}

function handleSearchCourses() {
  renderDetailedCoursesList();
}

// ─── DRAG & DROP REORDERING ──────────────────────────────────────────────────
let draggedCourseId = null;
let isDraggingFromHandle = false;

function handleDragStart(e, id) {
  if (!isDraggingFromHandle) {
    e.preventDefault();
    return false;
  }
  draggedCourseId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const card = e.target.closest('[draggable="true"]');
    if (card) {
      card.classList.add('opacity-40');
    }
  }, 0);
}

function handleDragOver(e) {
  e.preventDefault();
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const relX = e.clientX - rect.left;
  const midX = rect.width / 2;
  const indL = el.querySelector('.drag-indicator-left');
  const indR = el.querySelector('.drag-indicator-right');
  if (relX < midX) {
    if (indL) indL.style.opacity = '1';
    if (indR) indR.style.opacity = '0';
    el.dataset.dropSide = 'left';
  } else {
    if (indR) indR.style.opacity = '1';
    if (indL) indL.style.opacity = '0';
    el.dataset.dropSide = 'right';
  }
  return false;
}

function handleDragEnter(e, el) {
  e.preventDefault();
  el.classList.add('bg-[#2a2a2a]/60');
}

function handleDragLeave(e, el) {
  el.classList.remove('bg-[#2a2a2a]/60');
  const indL = el.querySelector('.drag-indicator-left');
  const indR = el.querySelector('.drag-indicator-right');
  if (indL) indL.style.opacity = '0';
  if (indR) indR.style.opacity = '0';
  delete el.dataset.dropSide;
}

function handleDrop(e, targetId) {
  e.stopPropagation();
  e.preventDefault();
  if (draggedCourseId === null || draggedCourseId === targetId) return;
  const el = e.currentTarget;
  const side = el.dataset.dropSide || 'left';
  const dragIdx = state.courses.findIndex(c => c.id === draggedCourseId);
  if (dragIdx === -1) return;
  const [draggedCourse] = state.courses.splice(dragIdx, 1);
  let targetIdx = state.courses.findIndex(c => c.id === targetId);
  if (targetIdx !== -1) {
    if (side === 'right') {
      state.courses.splice(targetIdx + 1, 0, draggedCourse);
    } else {
      state.courses.splice(targetIdx, 0, draggedCourse);
    }
    persistAndSync();
  }
}

function handleDragEnd(e) {
  e.target.classList.remove('opacity-40');
  draggedCourseId = null;
  document.querySelectorAll('#courses-grid > div').forEach(el => {
    el.classList.remove('bg-[#2a2a2a]/60');
    const indL = el.querySelector('.drag-indicator-left');
    const indR = el.querySelector('.drag-indicator-right');
    if (indL) indL.style.opacity = '0';
    if (indR) indR.style.opacity = '0';
    delete el.dataset.dropSide;
  });
}

let draggedActivityId = null;
function onCalendarActivityDragStart(e, id) {
  draggedActivityId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(id));
  const card = e.target.closest('[draggable="true"]');
  if (card) {
    card.classList.add('opacity-40');
  }
}

function onCalendarActivityDragEnd(e) {
  const card = e.target.closest('[draggable="true"]');
  if (card) {
    card.classList.remove('opacity-40');
  }
  draggedActivityId = null;
  document.querySelectorAll('.cal-day-cell.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function onCalendarDayDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const cell = e.currentTarget;
  cell.classList.add('drag-over');
}

function onCalendarDayDragEnter(e) {
  e.currentTarget.classList.add('drag-over');
}

function onCalendarDayDragLeave(e) {
  const cell = e.currentTarget;
  const rect = cell.getBoundingClientRect();
  const x = e.clientX;
  const y = e.clientY;
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    cell.classList.remove('drag-over');
  }
}

function onCalendarDayDrop(e, dateStr) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const id = draggedActivityId || parseInt(e.dataTransfer.getData('text/plain'), 10);
  if (!id) return;
  const actividad = state.activities.find(a => a.id === id);
  if (!actividad) return;
  if (actividad.fecha === dateStr) return;
  actividad.fecha = dateStr;
  persistAndSync();
}

function syncSettingsCheckboxes() {
  const container = document.getElementById('schedule-properties-container');
  if (!container) return;
  if (!state.settings) return;
  const PROPERTIES = [
    { key: 'showHora', label: 'Horario', emoji: '⏰', bg: 'rgba(249, 115, 22, 0.2)', text: '#fb923c' },
    { key: 'showLugar', label: 'Lugar / Aula', emoji: '📍', bg: 'rgba(244, 63, 94, 0.2)', text: '#fb7185' },
    { key: 'showProfesor', label: 'Profesor', emoji: '👨‍🏫', bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa' },
    { key: 'showCorreo', label: 'Correo del Profesor', emoji: '✉️', bg: 'rgba(139, 92, 246, 0.2)', text: '#a78bfa' },
    { key: 'showTelefono', label: 'Número de Teléfono', emoji: '📞', bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399' }
  ];
  if (state.settings.customProperties && Array.isArray(state.settings.customProperties)) {
    state.settings.customProperties.forEach(prop => {
      PROPERTIES.push(prop);
    });
  }
  container.innerHTML = PROPERTIES.map(p => {
    const isVisible = !!state.settings[p.key];
    const isCustom = p.key && p.key.startsWith('customProp_');
    return `
      <div onclick="toggleSetting('${p.key}')" class="bg-[#232323] border border-zinc-800 rounded-2xl p-3.5 hover:border-zinc-700 transition flex items-center justify-between gap-3 group relative cursor-pointer select-none ${!isVisible ? 'opacity-60' : ''}">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0" style="background:${p.bg};color:${p.text}">
            ${p.emoji}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-sm text-white truncate">${p.label}</h4>
              ${!isVisible ? `<span class="bg-zinc-800 text-zinc-500 border border-zinc-750 text-[9px] px-1.5 py-0.5 rounded-md font-semibold tracking-wider uppercase">Oculto</span>` : ''}
            </div>
          </div>
        </div>
        <div class="flex items-center shrink-0 gap-1">
          ${isCustom ? `<button onclick="event.stopPropagation(); eliminarPropiedadPersonalizada('${p.key}')" title="Eliminar propiedad" class="bg-red-900/30 hover:bg-red-900/50 border border-red-900/50 text-red-400 rounded-xl w-7 h-7 flex items-center justify-center transition shrink-0 text-xs font-bold">✕</button>` : ''}
          <button onclick="event.stopPropagation(); toggleSetting('${p.key}')" title="${isVisible ? 'Ocultar propiedad' : 'Mostrar propiedad'}" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl w-8 h-8 flex items-center justify-center transition shrink-0">
            ${isVisible ? `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
              </svg>
            ` : `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            `}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleSetting(key) {
  if (state.settings && key in state.settings) {
    state.settings[key] = !state.settings[key];
    save();
    renderSchedule();
    syncSettingsCheckboxes();
    if (isModalOpen('modal-ver-horario')) renderDetailedScheduleList();
  }
}

function agregarPropiedadPersonalizada() {
  const input = document.getElementById('schedule-prop-custom-input');
  if (!input || !input.value.trim()) {
    alert('Por favor escribe una propiedad (ej: 🔧 Sala)');
    return;
  }
  const propName = input.value.trim();
  const propKey = 'customProp_' + Date.now();
  if (!state.settings.customProperties) {
    state.settings.customProperties = [];
  }
  const emojiMatch = propName.match(/^(\S+)\s+(.+)$/);
  const emoji = emojiMatch ? emojiMatch[1] : '🔧';
  const label = emojiMatch ? emojiMatch[2] : propName;
  state.settings.customProperties.push({
    key: propKey,
    label: label,
    emoji: emoji,
    bg: 'rgba(236, 72, 153, 0.2)',
    text: '#f472b6'
  });
  state.settings[propKey] = true;
  save();
  renderSchedule();
  syncSettingsCheckboxes();
  if (isModalOpen('modal-ver-horario')) renderDetailedScheduleList();
  input.value = '';
}

function eliminarPropiedadPersonalizada(key) {
  if (!state.settings.customProperties) return;
  state.settings.customProperties = state.settings.customProperties.filter(p => p.key !== key);
  delete state.settings[key];
  save();
  renderSchedule();
  syncSettingsCheckboxes();
  if (isModalOpen('modal-ver-horario')) renderDetailedScheduleList();
}

const CALENDAR_PROPERTY_DEFS = [
  { key: 'calShowTitulo', label: 'Título', emoji: '📝', bg: 'rgba(99, 102, 241, 0.2)', text: '#a5b4fc' },
  { key: 'calShowCurso', label: 'Curso', emoji: '📚', bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa' },
  { key: 'calShowTipos', label: 'Tipo(s) de actividad', emoji: '🏷️', bg: 'rgba(139, 92, 246, 0.2)', text: '#a78bfa' },
  { key: 'calShowImportancia', label: 'Importancia', emoji: '🔥', bg: 'rgba(239, 68, 68, 0.2)', text: '#f87171' },
  { key: 'calShowUrgencia', label: 'Urgencia / plazo', emoji: '⏳', bg: 'rgba(234, 179, 8, 0.2)', text: '#facc15' },
];

function syncCalendarSettingsCheckboxes() {
  const container = document.getElementById('calendar-properties-container');
  if (!container || !state.settings) return;
  container.className = 'flex flex-col gap-2';
  container.innerHTML = CALENDAR_PROPERTY_DEFS.map(p => {
    const isVisible = !!state.settings[p.key];
    return `
      <div onclick="toggleCalendarSetting('${p.key}')" class="w-full bg-[#232323] border border-zinc-800 rounded-2xl p-3.5 hover:border-zinc-700 transition flex items-center justify-between group relative cursor-pointer select-none ${!isVisible ? 'opacity-60' : ''}">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0" style="background:${p.bg};color:${p.text}">
            ${p.emoji}
          </div>
          <div class="min-w-0 flex-1">
            <h4 class="font-bold text-sm text-white">${p.label}</h4>
            ${!isVisible ? `<span class="inline-block mt-1 bg-zinc-800 text-zinc-500 border border-zinc-750 text-[9px] px-1.5 py-0.5 rounded-md font-semibold tracking-wider uppercase">Oculto</span>` : ''}
          </div>
        </div>
        <button onclick="event.stopPropagation(); toggleCalendarSetting('${p.key}')" title="${isVisible ? 'Ocultar propiedad' : 'Mostrar propiedad'}" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl w-8 h-8 flex items-center justify-center transition shrink-0">
            ${isVisible ? `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
              </svg>
            ` : `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            `}
          </button>
      </div>
    `;
  }).join('');
}

function toggleCalendarSetting(key) {
  if (state.settings && key in state.settings) {
    state.settings[key] = !state.settings[key];
    save();
    renderCalendar();
    syncCalendarSettingsCheckboxes();
    if (isModalOpen('modal-ver-dia') && modalVerDiaFecha) {
      const acts = state.activities.filter(a => a.fecha === modalVerDiaFecha);
      abrirModalVerDia(modalVerDiaFecha, acts);
    }
  }
}

function renderModalBulkActions() {
  const container = document.getElementById('modal-bulk-actions');
  if (!container) return;
  const selectedCount = selectedCourseIds.length;
  let html = '';
  if (modalMultiselectMode) {
    const searchInput = document.getElementById('search-courses');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const filteredCourses = state.courses.filter(c => {
      if (!query) return true;
      const titleMatch = c.title ? c.title.toLowerCase().includes(query) : false;
      const profMatch = c.profesor ? c.profesor.toLowerCase().includes(query) : false;
      const lugarMatch = c.lugar ? c.lugar.toLowerCase().includes(query) : false;
      return titleMatch || profMatch || lugarMatch;
    });
    const allFilteredSelected = filteredCourses.length > 0 && filteredCourses.every(c => selectedCourseIds.includes(c.id));
    html += `
      <button onclick="toggleSelectAllFiltered()" title="${allFilteredSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}" class="w-9 h-9 rounded-xl flex items-center justify-center bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 hover:text-white transition text-xs font-semibold">
        ${allFilteredSelected ? '🗹' : '☐'}
      </button>
    `;
    if (selectedCount > 0) {
      html += `
        <button onclick="bulkToggleOcultar()" title="Ocultar/Mostrar seleccionados" class="w-9 h-9 rounded-xl flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-emerald-450 hover:text-emerald-400 transition animate-in">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
      `;
      html += `
        <button onclick="bulkEliminar()" title="Eliminar seleccionados permanentemente" class="w-9 h-9 rounded-xl flex items-center justify-center bg-red-950/40 hover:bg-red-900/60 border border-red-900/50 text-red-400 hover:text-red-300 transition animate-in">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      `;
    }
  }
  html += `
    <button onclick="toggleModalMultiselectMode()" title="Selección múltiple" class="w-9 h-9 rounded-xl flex items-center justify-center transition border ${modalMultiselectMode
      ? 'bg-blue-600 border-blue-500 text-white'
      : 'bg-zinc-800 hover:bg-zinc-750 border-zinc-700 text-zinc-350 hover:text-white'
    }">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    </button>
  `;
  container.innerHTML = html;
}

function renderDetailedCoursesList() {
  renderModalBulkActions();
  const listEl = document.getElementById('detailed-courses-list');
  if (!listEl) return;
  if (!state.courses.length) {
    listEl.innerHTML = `<div class="text-center text-zinc-500 py-12 text-sm">No hay cursos registrados.</div>`;
    return;
  }
  const searchInput = document.getElementById('search-courses');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const filteredCourses = state.courses.filter(c => {
    if (!query) return true;
    const titleMatch = c.title ? c.title.toLowerCase().includes(query) : false;
    const profMatch = c.profesor ? c.profesor.toLowerCase().includes(query) : false;
    const lugarMatch = c.lugar ? c.lugar.toLowerCase().includes(query) : false;
    return titleMatch || profMatch || lugarMatch;
  });
  if (!filteredCourses.length) {
    listEl.innerHTML = `<div class="text-center text-zinc-500 py-12 text-sm">No se encontraron cursos que coincidan con la búsqueda.</div>`;
    return;
  }
  listEl.innerHTML = filteredCourses.map(c => {
    const isHidden = c.hidden || false;
    const isSelected = selectedCourseIds.includes(c.id);
    return `
      <div ${modalMultiselectMode ? `onclick="toggleSelectCourse(${c.id})"` : ''} class="bg-[#232323] border border-zinc-800 rounded-2xl p-3.5 hover:border-zinc-700 transition flex items-center justify-between gap-3 group relative cursor-pointer ${isHidden ? 'opacity-60' : ''} ${isSelected ? 'ring-2 ring-blue-500 border-transparent bg-[#262e3d]' : ''}">
        <div class="flex items-center gap-3 min-w-0">
          ${modalMultiselectMode ? `
            <div class="shrink-0 flex items-center justify-center">
              <input type="checkbox" ${isSelected ? 'checked' : ''} class="rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-0 focus:ring-offset-0 focus:outline-none w-4.5 h-4.5 cursor-pointer" onclick="event.stopPropagation(); toggleSelectCourse(${c.id})" />
            </div>
          ` : ''}
          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0" style="background:${c.bg};color:${c.text}">
            ${escapeHtml(c.emoji || '')}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-sm text-white truncate max-w-[140px] sm:max-w-[200px]">${c.title}</h4>
              ${isHidden ? `<span class="bg-zinc-800 text-zinc-500 border border-zinc-750 text-[9px] px-1.5 py-0.5 rounded-md font-semibold tracking-wider uppercase">Oculto</span>` : ''}
            </div>
          </div>
        </div>
        ${!modalMultiselectMode ? `
          <div class="flex items-center gap-1.5 shrink-0">
            <button onclick="event.stopPropagation(); toggleOcultarCurso(${c.id})" title="${isHidden ? 'Mostrar en pantalla principal' : 'Ocultar de pantalla principal'}" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl w-8 h-8 flex items-center justify-center transition">
              ${isHidden ? `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              ` : `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                </svg>
              `}
            </button>
            <button onclick="event.stopPropagation(); eliminarCursoDesdeModal(${c.id})" title="Eliminar permanentemente" class="bg-red-950/30 hover:bg-red-650 border border-red-900/40 hover:border-red-600 text-red-400 hover:text-white rounded-xl w-8 h-8 flex items-center justify-center transition">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function toggleModalMultiselectMode() {
  modalMultiselectMode = !modalMultiselectMode;
  selectedCourseIds = [];
  renderDetailedCoursesList();
}

function toggleSelectCourse(id) {
  const idx = selectedCourseIds.indexOf(id);
  if (idx === -1) {
    selectedCourseIds.push(id);
  } else {
    selectedCourseIds.splice(idx, 1);
  }
  renderDetailedCoursesList();
}

function toggleSelectAllFiltered() {
  const searchInput = document.getElementById('search-courses');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const filteredCourses = state.courses.filter(c => {
    if (!query) return true;
    const titleMatch = c.title ? c.title.toLowerCase().includes(query) : false;
    const profMatch = c.profesor ? c.profesor.toLowerCase().includes(query) : false;
    const lugarMatch = c.lugar ? c.lugar.toLowerCase().includes(query) : false;
    return titleMatch || profMatch || lugarMatch;
  });
  const allFilteredSelected = filteredCourses.length > 0 && filteredCourses.every(c => selectedCourseIds.includes(c.id));
  if (allFilteredSelected) {
    const filteredIds = filteredCourses.map(c => c.id);
    selectedCourseIds = selectedCourseIds.filter(id => !filteredIds.includes(id));
  } else {
    filteredCourses.forEach(c => {
      if (!selectedCourseIds.includes(c.id)) {
        selectedCourseIds.push(c.id);
      }
    });
  }
  renderDetailedCoursesList();
}

function bulkToggleOcultar() {
  if (!selectedCourseIds.length) return;
  const anyVisible = selectedCourseIds.some(id => {
    const c = state.courses.find(x => x.id === id);
    return c && !c.hidden;
  });
  state.courses.forEach(c => {
    if (selectedCourseIds.includes(c.id)) {
      c.hidden = anyVisible;
    }
  });
  persistAndSync();
}

function bulkEliminar() {
  if (!selectedCourseIds.length) return;
  const count = selectedCourseIds.length;
  if (confirm(`¿Desea eliminar permanentemente los ${count} cursos seleccionados?`)) {
    selectedCourseIds.forEach(id => {
      const curso = state.courses.find(c => c.id === id);
      if (curso && curso.title) eliminarReferenciasCurso(curso.title);
    });
    state.courses = state.courses.filter(c => !selectedCourseIds.includes(c.id));
    selectedCourseIds = [];
    persistAndSync();
  }
}

function renderCourses() {
  const grid = document.getElementById('courses-grid');
  if (!grid) return;
  const visibleCourses = state.courses.filter(c => !c.hidden);
  if (!visibleCourses.length) {
    grid.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-12 text-center bg-[#181818] border border-zinc-800 rounded-2xl p-6">
        <span class="text-4xl mb-2">👁️‍🗨️</span>
        <div class="font-semibold text-zinc-350 text-sm">No hay cursos activos en la pantalla principal</div>
        <p class="text-[11px] text-zinc-500 mt-1 max-w-xs">Puedes registrar nuevos cursos o ir a "Ver cursos" para restaurar los cursos ocultos.</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = visibleCourses.map(c => {
    return `
      <div draggable="true" ondragstart="handleDragStart(event, ${c.id})" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event, this)" ondragleave="handleDragLeave(event, this)" ondrop="handleDrop(event, ${c.id})" ondragend="handleDragEnd(event)" onclick="abrirCuadernoCurso(${c.id})" class="bg-[#232323] rounded-2xl overflow-hidden border border-zinc-700 hover:border-zinc-500 transition duration-200 card-hover animate-in group relative flex flex-col justify-between select-none cursor-pointer">
        <div class="drag-indicator-left absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-16 bg-blue-500 rounded-r-md opacity-0 transition duration-150 pointer-events-none z-25"></div>
        <div class="drag-indicator-right absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-16 bg-blue-500 rounded-l-md opacity-0 transition duration-150 pointer-events-none z-25"></div>
        <div>
          <div class="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition flex gap-1 z-10">
            <div onmousedown="isDraggingFromHandle = true" onmouseup="isDraggingFromHandle = false" onmouseleave="isDraggingFromHandle = false" onclick="event.stopPropagation();" title="Arrastrar para ordenar" class="drag-handle bg-black/60 hover:bg-zinc-800 border border-zinc-750 text-zinc-300 rounded-lg w-7 h-7 flex items-center justify-center transition cursor-grab active:cursor-grabbing">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-zinc-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0V12m-3 .5a1.5 1.5 0 003 0M10 12V8.5a1.5 1.5 0 113 0V12m-3 0a1.5 1.5 0 003 0M13 12V6.5a1.5 1.5 0 113 0V12m-3 0a1.5 1.5 0 003 0M16 12v-1.5a1.5 1.5 0 113 0V16m-3-4a1.5 1.5 0 003 0M16 16v3a2 2 0 01-2 2h-4a3 3 0 01-3-3V14" />
              </svg>
            </div>
          </div>
          <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition flex gap-1 z-10">
            <button onclick="event.stopPropagation(); abrirTablaCurso(${c.id})" title="Ver calificaciones" class="bg-black/60 hover:bg-zinc-800 border border-zinc-750 text-zinc-300 rounded-lg w-7 h-7 flex items-center justify-center transition font-bold text-xs">
              #
            </button>
            <button type="button" onclick="event.stopPropagation(); abrirEditarCurso(${c.id})" title="Editar curso" class="bg-black/60 hover:bg-zinc-800 border border-zinc-750 text-zinc-300 rounded-lg w-7 h-7 flex items-center justify-center transition">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-zinc-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232a2.5 2.5 0 013.536 3.536L7.5 20.036H3v-4.5L15.232 5.232z" />
              </svg>
            </button>
          </div>
          <div class="h-28 flex items-center justify-center text-4xl font-bold overflow-hidden" style="${c.imageUrl ? cloudinaryBackgroundStyle(c.imageUrl, { bg: c.bg, position: 'center' }) : `background:${c.bg};`} color:${c.text}">
            ${c.imageUrl ? '' : escapeHtml(c.emoji || '')}
          </div>
          <div class="p-4">
            <h3 class="font-semibold tracking-wide text-sm">${c.emoji ? escapeHtml(c.emoji) + ' ' : ''}${escapeHtml(c.title)}</h3>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── SCHEDULE ────────────────────────────────────────────────────────────────
function agregarClase() {
  const dia = document.getElementById('hor-dia').value;
  const val = document.getElementById('hor-clase').value;
  if (!val) {
    alert('Debes seleccionar un curso de la lista. Si no tienes cursos, créalos primero en la sección de Cursos.');
    return;
  }
  const horaInicioVal = document.getElementById('hor-nuevo-hora-inicio').value;
  const horaFinVal = document.getElementById('hor-nuevo-hora-fin').value;
  if (!horaInicioVal || !horaFinVal) {
    alert('La hora de inicio y fin de la clase son requeridas.');
    return;
  }
  const lugarVal = document.getElementById('hor-nuevo-lugar').value.trim();
  if (!lugarVal) {
    alert('El lugar o aula es requerido.');
    return;
  }
  const hora = `${formatTime12(horaInicioVal)} - ${formatTime12(horaFinVal)}`;
  const c = state.courses.find(x => x.title === val);
  if (c) {
    c.lugar = document.getElementById('hor-nuevo-lugar').value.trim();
    c.profesor = document.getElementById('hor-nuevo-profesor').value.trim();
    c.correo = document.getElementById('hor-nuevo-correo').value.trim();
    c.telefono = document.getElementById('hor-nuevo-telefono').value.trim();
  }
  if (editingScheduleDay !== null && editingScheduleIdx !== null) {
    if (editingScheduleDay !== dia) {
      state.schedule[editingScheduleDay].splice(editingScheduleIdx, 1);
      state.schedule[dia].push({
        clase: val,
        hora: hora
      });
    } else {
      state.schedule[dia][editingScheduleIdx] = {
        clase: val,
        hora: hora
      };
    }
  } else {
    state.schedule[dia].push({
      clase: val,
      hora: hora
    });
  }
  editingScheduleDay = null;
  editingScheduleIdx = null;
  persistAndSync();
  cerrarModal('modal-horario');
}
function eliminarClase(dia, idx) {
  state.schedule[dia].splice(idx, 1);
  persistAndSync();
}

function renderSchedule() {
  const grid = document.getElementById('schedule-grid');
  if (!grid) return;
  if (!state.settings.showDays) {
    state.settings.showDays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  }
  const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  ALL_DAYS.forEach(d => {
    if (!state.schedule[d]) {
      state.schedule[d] = [];
    } else {
      state.schedule[d].sort((a, b) => {
        let startA = '00:00';
        let startB = '00:00';
        if (a.hora) {
          const partsA = a.hora.split('-');
          if (partsA.length >= 1) {
            startA = parseTime12To24(partsA[0]) || '00:00';
          }
        }
        if (b.hora) {
          const partsB = b.hora.split('-');
          if (partsB.length >= 1) {
            startB = parseTime12To24(partsB[0]) || '00:00';
          }
        }
        return startA.localeCompare(startB);
      });
    }
  });
  const visibleDays = ALL_DAYS.filter(d => state.settings.showDays.includes(d));
  grid.className = `grid gap-4 min-w-[700px]`;
  grid.style.gridTemplateColumns = `repeat(${visibleDays.length || 1}, minmax(0, 1fr))`;
  if (!visibleDays.length) {
    grid.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-16 text-center bg-[#232323]/50 border border-zinc-800 rounded-2xl p-8 w-full select-none">
        <span class="text-4xl mb-3">📅</span>
        <div class="font-bold text-zinc-350 text-sm">No hay días visibles seleccionados</div>
        <p class="text-[11px] text-zinc-500 mt-1.5 max-w-xs">Usa los ajustes del horario (⚙️) para activar y organizar los días de la semana.</p>
      </div>
    `;
    return;
  }
  const DAY_HEADER_STYLES = {
    Lunes: 'bg-blue-600/20 border-blue-700/50 text-blue-300',
    Martes: 'bg-emerald-600/20 border-emerald-700/50 text-emerald-300',
    Miércoles: 'bg-orange-600/20 border-orange-700/50 text-orange-300',
    Jueves: 'bg-purple-600/20 border-purple-700/50 text-purple-300',
    Viernes: 'bg-rose-600/20 border-rose-700/50 text-rose-300',
    Sábado: 'bg-pink-600/20 border-pink-700/50 text-pink-300',
    Domingo: 'bg-cyan-600/20 border-cyan-700/50 text-cyan-300'
  };
  grid.innerHTML = visibleDays.map(day => `
    <div class="space-y-3">
      <div class="${DAY_HEADER_STYLES[day] || 'bg-blue-600/20 border-blue-700/50 text-blue-300'} border text-center py-2 rounded-xl font-semibold text-sm">${day}</div>
      ${state.schedule[day].length === 0 ? `
        <div class="text-center py-8 border border-zinc-850 rounded-2xl text-[10px] text-zinc-650 font-medium select-none">Sin clases</div>
      ` : state.schedule[day].map((item, idx) => {
    const course = state.courses.find(c => c.title.trim().toUpperCase() === item.clase.trim().toUpperCase());
    const detailsHtml = buildScheduleDetailsHtml(course, item);
    const hasDetails = !!detailsHtml;
    return `
          <div onclick="abrirEditarClase('${day}', ${idx})" class="bg-[#232323] border border-zinc-700 rounded-2xl overflow-hidden hover:border-zinc-500 transition group relative flex flex-col justify-between select-none cursor-pointer">
            <div class="p-4">
              <button onclick="event.stopPropagation(); eliminarClase('${day}',${idx})" class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition bg-black/40 hover:bg-red-600 rounded-lg w-6 h-6 flex items-center justify-center text-xs z-10">✕</button>
              <div class="font-semibold text-sm pr-5 flex items-center gap-1.5">
                <span>${escapeHtml(course && course.emoji ? course.emoji : '📚')}</span>
                <span>${escapeHtml(item.clase)}</span>
              </div>
            </div>
            ${hasDetails ? `
              <div class="px-4 pb-4 pt-2 border-t border-zinc-800 text-[11px] text-zinc-450 space-y-1 bg-[#1c1c1c]/40">
                ${detailsHtml}
              </div>
            ` : ''}
          </div>
        `;
  }).join('')}
    </div>
  `).join('');
}

function toggleScheduleSettingsDropdown(e) {
  if (e) e.stopPropagation();
  abrirModal('modal-ajustes-horario');
}

function renderScheduleDaysCheckboxes() {
  const container = document.getElementById('schedule-days-checkboxes');
  if (!container) return;
  const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  if (!state.settings.showDays) {
    state.settings.showDays = [...ALL_DAYS];
  }
  container.innerHTML = ALL_DAYS.map(day => {
    const isChecked = state.settings.showDays.includes(day);
    const dayColors = {
      Lunes: { bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa' },
      Martes: { bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399' },
      Miércoles: { bg: 'rgba(249, 115, 22, 0.2)', text: '#fb923c' },
      Jueves: { bg: 'rgba(139, 92, 246, 0.2)', text: '#a78bfa' },
      Viernes: { bg: 'rgba(244, 63, 94, 0.2)', text: '#fb7185' },
      Sábado: { bg: 'rgba(236, 72, 153, 0.2)', text: '#f472b6' },
      Domingo: { bg: 'rgba(6, 182, 212, 0.2)', text: '#22d3ee' }
    };
    const colors = dayColors[day] || { bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa' };
    return `
      <div onclick="toggleScheduleDay('${day}'); renderScheduleDaysCheckboxes();" class="bg-[#232323] border border-zinc-800 rounded-2xl p-3.5 hover:border-zinc-700 transition flex items-center justify-between gap-3 group relative cursor-pointer ${!isChecked ? 'opacity-60' : ''}">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0" style="background:${colors.bg};color:${colors.text}">
            📅
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-bold text-sm text-white truncate">${day}</h4>
              ${!isChecked ? `<span class="bg-zinc-800 text-zinc-500 border border-zinc-750 text-[9px] px-1.5 py-0.5 rounded-md font-semibold tracking-wider uppercase">Oculto</span>` : ''}
            </div>
          </div>
        </div>
        <div class="flex items-center shrink-0">
          <button onclick="event.stopPropagation(); toggleScheduleDay('${day}'); renderScheduleDaysCheckboxes();" title="${isChecked ? 'Ocultar día' : 'Mostrar día'}" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl w-8 h-8 flex items-center justify-center transition shrink-0">
            ${isChecked ? `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
              </svg>
            ` : `
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            `}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleScheduleDay(day) {
  if (!state.settings.showDays) {
    state.settings.showDays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  }
  const idx = state.settings.showDays.indexOf(day);
  if (idx === -1) {
    state.settings.showDays.push(day);
  } else {
    state.settings.showDays.splice(idx, 1);
  }
  persistAndSync();
}

function renderDetailedScheduleList() {
  const listEl = document.getElementById('detailed-schedule-list');
  if (!listEl) return;
  const searchInput = document.getElementById('search-schedule');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const ALL_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  let html = '';
  let foundAny = false;
  ALL_DAYS.forEach(day => {
    const classes = state.schedule[day] || [];
    const filtered = classes.map((c, originalIdx) => ({ ...c, originalIdx }))
      .filter(item => {
        if (!query) return true;
        const claseMatch = item.clase ? item.clase.toLowerCase().includes(query) : false;
        const horaMatch = item.hora ? item.hora.toLowerCase().includes(query) : false;
        const dayMatch = day.toLowerCase().includes(query);
        return claseMatch || horaMatch || dayMatch;
      });
    if (filtered.length > 0) {
      foundAny = true;
      html += `
        <div class="space-y-2">
          <h4 class="text-xs font-semibold text-blue-400 uppercase tracking-wider pl-1">${day}</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            ${filtered.map(item => {
        const course = state.courses.find(c => c.title.trim().toUpperCase() === item.clase.trim().toUpperCase());
        const detailsHtml = buildScheduleDetailsHtml(course, item);
        const hasDetails = !!detailsHtml;
        const emoji = course ? course.emoji || '📚' : '📚';
        return `
                <div onclick="cerrarModal('modal-ver-horario'); abrirEditarClase('${day}', ${item.originalIdx})" class="bg-[#232323] border border-zinc-800 rounded-xl p-3.5 hover:border-zinc-700 transition flex items-center justify-between gap-3 group relative cursor-pointer">
                  <div class="min-w-0 flex items-start gap-2.5">
                    <span class="text-xl shrink-0 mt-0.5">${emoji}</span>
                    <div class="min-w-0">
                      <div class="font-bold text-sm text-white truncate">${item.clase}</div>
                      ${hasDetails ? `
                        <div class="text-[11px] text-zinc-450 mt-1.5 space-y-1">
                          ${detailsHtml}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                  <button onclick="event.stopPropagation(); eliminarClaseDesdeModal('${day}', ${item.originalIdx})" title="Eliminar clase" class="bg-red-950/30 hover:bg-red-650 border border-red-900/40 hover:border-red-600 text-red-400 hover:text-white rounded-lg w-7 h-7 flex items-center justify-center transition shrink-0">
                    ✕
                  </button>
                </div>
              `;
      }).join('')}
          </div>
        </div>
      `;
    }
  });
  if (!foundAny) {
    listEl.innerHTML = `<div class="text-center text-zinc-500 py-12 text-sm">No se encontraron clases.</div>`;
  } else {
    listEl.innerHTML = html;
  }
}

function eliminarClaseDesdeModal(day, idx) {
  if (confirm('¿Desea eliminar esta clase del horario?')) {
    state.schedule[day].splice(idx, 1);
    persistAndSync();
  }
}

function handleSearchSchedule() {
  renderDetailedScheduleList();
}

// ─── ACTIVIDADES ──────────────────────────────────────────────────────────────
function updateActSelect() {
  const sel = document.getElementById('act-curso');
  sel.innerHTML = `<option value="">Seleccionar curso</option>` +
    state.courses.map(c => `<option value="${c.title}">${c.title}</option>`).join('');
}

let selectedTipos = [];
let savedTipos = [];

const BASE_TIPO_DETAILS = {
  tarea: { emoji: '📝', label: 'Tarea' },
  examen: { emoji: '📋', label: 'Examen' },
  practica: { emoji: '🧪', label: 'Práctica' },
  exposicion: { emoji: '🗣️', label: 'Exposición' },
  parcial: { emoji: '📝', label: 'Parcial' },
  junta: { emoji: '👥', label: 'Junta' },
  producto: { emoji: '📦', label: 'Producto' },
  investigar: { emoji: '🔍', label: 'Investigar' }
};

function isMobileTiposView() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function posicionarPopTiposDesktop() {
  const panel = document.getElementById('pop-tipos-panel');
  const trigger = document.getElementById('btn-tipos-trigger');
  if (!panel || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const panelWidth = 320;
  let left = rect.right + 12;
  let top = rect.top - 80;
  if (left + panelWidth > window.innerWidth - 16) {
    left = Math.max(16, rect.left - panelWidth - 12);
  }
  if (top + 400 > window.innerHeight - 16) {
    top = Math.max(16, window.innerHeight - 420);
  }
  if (top < 16) top = 16;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${panelWidth}px`;
}

function abrirPopTipos(event) {
  if (event) event.stopPropagation();
  const panel = document.getElementById('pop-tipos-panel');
  const backdrop = document.getElementById('pop-tipos-backdrop');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    panel.classList.remove('hidden');
    renderTiposGrid();
    if (isMobileTiposView()) {
      backdrop?.classList.remove('hidden');
      panel.classList.add('pop-tipos-panel--mobile');
      panel.classList.remove('pop-tipos-panel--desktop');
    } else {
      backdrop?.classList.add('hidden');
      panel.classList.add('pop-tipos-panel--desktop');
      panel.classList.remove('pop-tipos-panel--mobile');
      posicionarPopTiposDesktop();
    }
  } else {
    cerrarPopTipos();
  }
}

function renderTiposGrid() {
  const grid = document.getElementById('pop-tipos-grid');
  if (!grid) return;
  const keys = Object.keys(TIPO_DETAILS);
  grid.innerHTML = keys.map((k, idx) => {
    const detail = TIPO_DETAILS[k];
    const isSelected = selectedTipos.includes(k);
    const isLastOdd = (keys.length % 2 !== 0) && (idx === keys.length - 1);
    const gridColClass = isLastOdd ? 'col-span-2 justify-center' : '';
    return `
      <div class="relative ${gridColClass}">
        <button type="button" onclick="event.stopPropagation(); toggleTipoSeleccionado('${k}')" id="btn-tipo-${k}" class="w-full text-left py-3 px-4 rounded-xl border text-base font-semibold transition focus:outline-none flex items-center gap-2 ${isSelected ? 'border-blue-500 bg-blue-600/10 text-white font-bold' : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 font-semibold'}">
          <span>${detail.emoji}</span> ${detail.label}
        </button>
        ${!BASE_TIPO_DETAILS[k] ? `<button type="button" onclick="event.stopPropagation(); eliminarTipo(event, '${k}')" class="absolute top-2 right-2 rounded-full bg-zinc-900/90 text-zinc-400 hover:text-white hover:bg-red-600/90 w-6 h-6 flex items-center justify-center text-xs">✕</button>` : ''}
      </div>
    `;
  }).join('');
}

function toggleTipoSeleccionado(tipo) {
  const idx = selectedTipos.indexOf(tipo);
  if (idx > -1) {
    selectedTipos.splice(idx, 1);
  } else {
    selectedTipos.push(tipo);
  }
  savedTipos = [...selectedTipos];
  actualizarTextoTiposSeleccionados();
  renderTiposGrid();
}

function cerrarPopTipos() {
  const panel = document.getElementById('pop-tipos-panel');
  const backdrop = document.getElementById('pop-tipos-backdrop');
  if (panel) {
    panel.classList.add('hidden');
    panel.classList.remove('pop-tipos-panel--mobile', 'pop-tipos-panel--desktop');
    panel.style.left = '';
    panel.style.top = '';
    panel.style.width = '';
  }
  backdrop?.classList.add('hidden');
}

function eliminarTipo(event, tipo) {
  if (event) {
    event.stopPropagation();
  }
  if (BASE_TIPO_DETAILS[tipo]) {
    return;
  }
  selectedTipos = selectedTipos.filter(t => t !== tipo);
  savedTipos = savedTipos.filter(t => t !== tipo);
  delete TIPO_DETAILS[tipo];
  renderTiposGrid();
  actualizarTextoTiposSeleccionados();
}

function agregarTipoPersonalizado() {
  const input = document.getElementById('act-tipo-custom-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  let emoji = '📌';
  let cleanLabel = val;
  const emojiRegex = /^\p{Emoji}/u;
  const match = cleanLabel.match(emojiRegex);
  if (match) {
    emoji = match[0];
    cleanLabel = cleanLabel.replace(emojiRegex, '').trim();
  }
  if (!cleanLabel) {
    cleanLabel = val;
  }
  const key = cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, '') || `custom${Date.now()}`;
  TIPO_DETAILS[key] = { emoji, label: cleanLabel };
  if (!selectedTipos.includes(key)) {
    selectedTipos.push(key);
  }
  input.value = '';
  renderTiposGrid();
}

function actualizarTextoTiposSeleccionados() {
  const triggerText = document.getElementById('txt-tipos-selected');
  if (triggerText) {
    if (savedTipos.length === 0) {
      triggerText.textContent = 'Seleccionar tipos...';
      triggerText.classList.add('text-zinc-400');
      triggerText.classList.remove('text-white', 'font-medium');
    } else {
      const labels = savedTipos.map(t => {
        const d = TIPO_DETAILS[t] || { emoji: '📌', label: t };
        return `${d.emoji} ${d.label}`;
      }).join(', ');
      triggerText.textContent = labels;
      triggerText.classList.remove('text-zinc-400');
      triggerText.classList.add('text-white', 'font-medium');
    }
  }
}

function guardarTiposSeleccionados(event) {
  if (event) event.stopPropagation();
  savedTipos = [...selectedTipos];
  cerrarPopTipos();
  actualizarTextoTiposSeleccionados();
}

function resetTiposSeleccionados() {
  selectedTipos = [];
  savedTipos = [];
  for (const k in TIPO_DETAILS) {
    if (!BASE_TIPO_DETAILS[k]) {
      delete TIPO_DETAILS[k];
    }
  }
  const input = document.getElementById('act-tipo-custom-input');
  if (input) input.value = '';
  const triggerText = document.getElementById('txt-tipos-selected');
  if (triggerText) {
    triggerText.textContent = 'Seleccionar tipos...';
    triggerText.classList.add('text-zinc-400');
    triggerText.classList.remove('text-white', 'font-medium');
  }
  cerrarPopTipos();
  renderTiposGrid();
}

function agregarActividad() {
  const titulo = document.getElementById('act-titulo').value.trim();
  const curso = document.getElementById('act-curso').value;
  const fecha = document.getElementById('act-fecha').value;
  const importancia = document.getElementById('act-importancia').value;
  if (!titulo || !fecha || savedTipos.length === 0) {
    alert('Por favor completa los campos obligatorios (* y selecciona al menos un tipo de actividad en la ventana de tipos).');
    return;
  }
  if (editingActivityId !== null) {
    const actividad = state.activities.find(a => a.id === editingActivityId);
    if (actividad) {
      actividad.titulo = titulo;
      actividad.curso = curso;
      actividad.fecha = fecha;
      actividad.tipos = [...savedTipos];
      actividad.tipo = savedTipos[0];
      actividad.importancia = importancia;
    }
    editingActivityId = null;
  } else {
    state.activities.push({
      id: uid(),
      titulo,
      curso,
      fecha,
      fechaInicio: new Date().toISOString().split('T')[0],
      tipos: [...savedTipos],
      tipo: savedTipos[0],
      importancia,
      done: false
    });
  }
  persistAndSync();
  cerrarModal('modal-actividad');
  document.getElementById('act-titulo').value = '';
  document.getElementById('act-fecha').value = '';
  document.getElementById('act-importancia').value = 'media';
  resetTiposSeleccionados();
}

function selectImportancia(level) {
  const inputEl = document.getElementById('act-importancia');
  if (inputEl) inputEl.value = level;
  const levels = ['alta', 'media', 'baja'];
  levels.forEach(l => {
    const btn = document.getElementById(`btn-imp-${l}`);
    if (btn) {
      if (l === level) {
        btn.classList.add('ring-2', 'ring-white', 'scale-[1.02]');
        btn.classList.remove('opacity-60');
      } else {
        btn.classList.remove('ring-2', 'ring-white', 'scale-[1.02]');
        btn.classList.add('opacity-60');
      }
    }
  });
}

let currentActivityFilter = 'todas';
function toggleActivityFilter(filter) {
  if (currentActivityFilter === filter) {
    currentActivityFilter = 'todas';
  } else {
    currentActivityFilter = filter;
  }
  renderActivities();
}

function marcarActividadHecha(id) {
  const idx = state.activities.findIndex(x => x.id === id);
  if (idx === -1) return;
  const a = state.activities[idx];
  a.done = true;
  a.fechaCompletada = new Date().toISOString().split('T')[0];
  state.activityHistory.unshift(a);
  state.activities.splice(idx, 1);
  persistAndSync();
}

function eliminarAct(id) {
  state.activities = state.activities.filter(x => x.id !== id);
  persistAndSync();
}

function eliminarDelHistorial(id) {
  if (!confirm('¿Eliminar esta actividad del historial permanentemente?')) return;
  state.activityHistory = state.activityHistory.filter(x => x.id !== id);
  save();
  renderHistorialList();
  renderActivities();
}

function getImportanceBadgeHtml(level, compact = false) {
  const badges = {
    alta: { label: '🔥 Alta', classes: 'bg-red-950/40 text-red-400 border border-red-900/50' },
    media: { label: '⚡ Media', classes: 'bg-sky-950/40 text-sky-400 border border-sky-900/50' },
    baja: { label: '🌱 Baja', classes: 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50' }
  };
  const info = badges[level];
  if (!info) return '';
  const base = compact ? 'text-[9px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded' : 'text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded';
  return `<span class="${base} ${info.classes}">${info.label}</span>`;
}

function buildActivityCardContent(a, { strikethrough = false, showUrgency = true } = {}) {
  const days = daysUntil(a.fecha);
  const importanceHtml = a.importancia ? getImportanceBadgeHtml(a.importancia) : '';
  const tiposArray = a.tipos || (a.tipo ? [a.tipo] : []);
  const tiposHtml = tiposArray.map(t => {
    const d = TIPO_DETAILS[t] || { emoji: '📌', label: t };
    return `<span class="inline-flex items-center gap-1 bg-[#2a2a2a] text-zinc-350 text-xs px-2 py-0.5 rounded-lg border border-zinc-700/60">${d.emoji} ${d.label}</span>`;
  }).join(' ');
  const titleClass = strikethrough ? 'line-through text-zinc-500' : '';
  const statusHtml = strikethrough
    ? `<span class="text-xs tag-green px-2 py-0.5 rounded-lg">✅ Completada${a.fechaCompletada ? ` · ${a.fechaCompletada}` : ''}</span>`
    : (showUrgency ? urgencyTag(days) : '');
  return `
    <div class="font-medium ${titleClass}">${a.titulo}</div>
    <div class="flex items-center gap-2 mt-1.5 flex-wrap">
      <span class="font-bold text-blue-450 bg-blue-950/30 border border-blue-800/40 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">${a.curso || 'Sin curso'}</span>
      <span class="text-zinc-400 text-xs font-semibold">Entrega: ${a.fecha}</span>
      ${tiposHtml}
      ${statusHtml}
      ${importanceHtml}
    </div>
  `;
}

function renderActividadHechoCheck(id) {
  return `
    <button type="button" onclick="event.stopPropagation(); marcarActividadHecha(${id})" class="act-done-check shrink-0 mt-0.5 flex items-center gap-2 group/check" title="Marcar como hecha">
      <span class="act-done-box w-5 h-5 rounded-md border-2 border-zinc-500 shrink-0"></span>
      <span class="text-xs font-semibold text-zinc-400">Hecho</span>
    </button>
  `;
}

function renderHistorialList() {
  const list = document.getElementById('historial-list');
  const countEl = document.getElementById('historial-count');
  if (!list) return;
  const searchInput = document.getElementById('search-historial');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  let items = [...state.activityHistory];
  if (query) {
    items = items.filter(a => {
      const t = a.titulo ? a.titulo.toLowerCase() : '';
      const c = a.curso ? a.curso.toLowerCase() : '';
      return t.includes(query) || c.includes(query);
    });
  }
  items.sort((a, b) => {
    const da = new Date((b.fechaCompletada || b.fecha) + 'T00:00:00');
    const db = new Date((a.fechaCompletada || a.fecha) + 'T00:00:00');
    return da - db;
  });
  if (countEl) countEl.textContent = `${state.activityHistory.length} en total`;
  if (!items.length) {
    list.innerHTML = `<div class="text-center text-zinc-500 py-12 text-sm">${state.activityHistory.length ? 'No hay coincidencias con la búsqueda.' : 'Aún no hay actividades completadas. Marca una como «Hecho» para verla aquí.'}</div>`;
    return;
  }
  list.innerHTML = items.map(a => `
    <div class="flex items-start gap-3 p-4 bg-[#232323] border border-zinc-700 rounded-2xl opacity-80 animate-in">
      <span class="mt-1 w-5 h-5 rounded-md bg-emerald-600 border border-emerald-500 flex items-center justify-center shrink-0 text-xs text-white">✓</span>
      <div class="flex-1 min-w-0">${buildActivityCardContent(a, { strikethrough: true, showUrgency: false })}</div>
      <button onclick="eliminarDelHistorial(${a.id})" class="text-zinc-500 hover:text-red-400 text-lg shrink-0" title="Eliminar del historial">✕</button>
    </div>
  `).join('');
}

function handleSearchHistorial() {
  renderHistorialList();
}

function renderActivities() {
  const list = document.getElementById('act-list');
  let filtered = [...state.activities];
  if (currentActivityFilter === 'hoy') {
    filtered = filtered.filter(a => daysUntil(a.fecha) === 0);
  } else if (currentActivityFilter === '7dias') {
    filtered = filtered.filter(a => { const d = daysUntil(a.fecha); return d > 0 && d <= 7; });
  } else if (currentActivityFilter === '15dias') {
    filtered = filtered.filter(a => { const d = daysUntil(a.fecha); return d > 7 && d <= 15; });
  } else if (currentActivityFilter === '1mes') {
    filtered = filtered.filter(a => daysUntil(a.fecha) > 15);
  }
  const sorted = filtered.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const statsEl = document.getElementById('act-stats');
  const todayCount = state.activities.filter(a => daysUntil(a.fecha) === 0).length;
  const week7Count = state.activities.filter(a => { const d = daysUntil(a.fecha); return d > 0 && d <= 7; }).length;
  const week15Count = state.activities.filter(a => { const d = daysUntil(a.fecha); return d > 7 && d <= 15; }).length;
  const monthCount = state.activities.filter(a => daysUntil(a.fecha) > 15).length;
  const allCount = state.activities.length;
  statsEl.innerHTML = `
    <div onclick="toggleActivityFilter('todas')" class="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] transition rounded-xl cursor-pointer ring-2 ${currentActivityFilter === 'todas' ? 'ring-blue-500 bg-[#333]' : 'ring-transparent'}">
      <span class="text-xl">📋</span>
      <div><div class="font-semibold text-white">Todas</div><div class="text-zinc-400 text-sm">${allCount} actividades</div></div>
    </div>
    <div onclick="toggleActivityFilter('hoy')" class="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] transition rounded-xl cursor-pointer ring-2 ${currentActivityFilter === 'hoy' ? 'ring-blue-500 bg-[#333]' : 'ring-transparent'}">
      <span class="text-xl">🔥</span>
      <div><div class="font-semibold text-white">Hoy</div><div class="text-zinc-400 text-sm">${todayCount} actividades</div></div>
    </div>
    <div onclick="toggleActivityFilter('7dias')" class="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] transition rounded-xl cursor-pointer ring-2 ${currentActivityFilter === '7dias' ? 'ring-blue-500 bg-[#333]' : 'ring-transparent'}">
      <span class="text-xl">7️⃣</span>
      <div><div class="font-semibold text-white">7 días</div><div class="text-zinc-400 text-sm">${week7Count} actividades</div></div>
    </div>
    <div onclick="toggleActivityFilter('15dias')" class="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] transition rounded-xl cursor-pointer ring-2 ${currentActivityFilter === '15dias' ? 'ring-blue-500 bg-[#333]' : 'ring-transparent'}">
      <span class="text-xl">⏳</span>
      <div><div class="font-semibold text-white">15 días</div><div class="text-zinc-400 text-sm">${week15Count} actividades</div></div>
    </div>
    <div onclick="toggleActivityFilter('1mes')" class="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] transition rounded-xl cursor-pointer ring-2 ${currentActivityFilter === '1mes' ? 'ring-blue-500 bg-[#333]' : 'ring-transparent'}">
      <span class="text-xl">🗓️</span>
      <div><div class="font-semibold text-white">1 mes+</div><div class="text-zinc-400 text-sm">${monthCount} actividades</div></div>
    </div>
  `;
  if (!sorted.length) {
    list.innerHTML = `<div class="text-center text-zinc-500 py-12">Sin actividades pendientes. ${currentActivityFilter && currentActivityFilter !== 'todas' ? '¡Prueba con otro filtro!' : '¡Agrega una o revisa el historial! 🎉'}</div>`;
    return;
  }
  list.innerHTML = sorted.map(a => `
    <div class="flex items-start gap-3 p-4 bg-[#232323] border border-zinc-700 rounded-2xl hover:border-zinc-500 transition group animate-in cursor-pointer" onclick="abrirEditarActividadModal(${a.id})">
      <div class="flex-1 min-w-0">${buildActivityCardContent(a)}</div>
      <div class="shrink-0 flex flex-col gap-2 items-end" onclick="event.stopPropagation()">
        <button type="button" onclick="abrirEditarActividadModal(${a.id})" class="text-xs text-blue-400 hover:text-blue-300 font-medium">Editar</button>
        ${renderActividadHechoCheck(a.id)}
      </div>
    </div>
  `).join('');
}

// ─── CALENDAR ────────────────────────────────────────────────────────────────
function calPropRow(inner) {
  return `<div class="cal-prop-row w-full">${inner}</div>`;
}

function renderCalHechoCheck(id) {
  return calPropRow(`
    <button type="button" onclick="event.stopPropagation(); marcarActividadHecha(${id})" class="act-done-check act-done-check--cal w-full flex items-center gap-1.5" title="Marcar como hecha">
      <span class="act-done-box w-3.5 h-3.5 rounded border-2 border-zinc-500 shrink-0"></span>
      <span class="text-xs font-semibold text-zinc-400">Hecho</span>
    </button>
  `);
}

function renderCalendarActivityDots(acts) {
  if (!acts.length) return '';
  return `
    <div class="cal-day-dots cal-day-dots--mobile" aria-label="${acts.length} actividad${acts.length === 1 ? '' : 'es'}">
      ${acts.map(() => '<span class="cal-act-dot"></span>').join('')}
    </div>
  `;
}

function renderCalendarActivityCard(a) {
  const s = state.settings;
  const days = daysUntil(a.fecha);
  const titleRow = s.calShowTitulo
    ? calPropRow(`<div class="font-semibold text-sm text-zinc-100 leading-tight">${a.titulo}</div>`)
    : '';
  const details = [];
  const cardBg = 'rgba(148,163,184,0.10)';
  const cardBorder = 'rgba(148,163,184,0.20)';
  const cardText = '#e2e8f0';
  if (s.calShowCurso && a.curso) {
    details.push(calPropRow(`<span class="inline-block font-bold text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded" style="background:rgba(148,163,184,0.16); color:#e5e7eb; border:1px solid rgba(148,163,184,0.30)">${a.curso}</span>`));
  }
  if (s.calShowTipos) {
    const tiposArray = a.tipos || (a.tipo ? [a.tipo] : []);
    tiposArray.forEach(t => {
      const d = TIPO_DETAILS[t] || { emoji: '📌', label: t };
      details.push(calPropRow(`<span class="inline-flex items-center gap-0.5 bg-[#2a2a2a] text-zinc-300 text-xs px-2 py-1 rounded border border-zinc-700/60 font-medium">${d.emoji} ${d.label}</span>`));
    });
  }
  if (s.calShowImportancia && a.importancia) {
    details.push(calPropRow(getImportanceBadgeHtml(a.importancia, true)));
  }
  if (s.calShowUrgencia) {
    details.push(calPropRow(urgencyTag(days)));
  }
  details.push(renderCalHechoCheck(a.id));
  return `
    <div draggable="true" ondragstart="onCalendarActivityDragStart(event, ${a.id})" ondragend="onCalendarActivityDragEnd(event)" class="cal-act-card flex flex-col gap-1.5 items-stretch p-1.5 rounded-lg border cursor-pointer hover:brightness-110 transition" style="background:${cardBg}; color:${cardText}; border:1px solid ${cardBorder};" onclick="abrirEditarActividadModal(${a.id})">
      <div class="flex items-start justify-between gap-2">
        ${titleRow}
        <button type="button" onclick="event.stopPropagation(); toggleCalendarActivityDetails(${a.id}, this)" class="cal-act-toggle-btn text-zinc-300 hover:text-white" title="Mostrar propiedades">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
      </div>
      <div id="cal-activity-details-${a.id}" class="cal-act-details hidden space-y-1">
        ${details.join('')}
      </div>
    </div>
  `;
}

function toggleCalendarActivityDetails(id, btn) {
  const details = document.getElementById(`cal-activity-details-${id}`);
  if (!details) return;
  const isHidden = details.classList.toggle('hidden');
  const icon = btn.querySelector('svg');
  if (icon) {
    icon.innerHTML = isHidden
      ? '<polyline points="18 15 12 9 6 15"></polyline>'
      : '<polyline points="6 9 12 15 18 9"></polyline>';
  }
  btn.title = isHidden ? 'Mostrar propiedades' : 'Ocultar propiedades';
}

function renderCalendar() {
  const title = document.getElementById('cal-title');
  const grid = document.getElementById('cal-grid');
  const today = new Date();
  const y = currentYear, m = currentMonth;
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  title.textContent = `${months[m]} ${y}`;
  const actMap = {};
  state.activities.forEach(a => {
    const d = new Date(a.fecha + 'T00:00:00');
    if (d.getFullYear() === y && d.getMonth() === m) {
      const day = d.getDate();
      if (!actMap[day]) actMap[day] = [];
      actMap[day].push(a);
    }
  });
  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += `<div class="cal-day-cell cal-day-empty border border-zinc-800 p-2 min-h-[7rem]"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = today.getDate() === d && today.getMonth() === m && today.getFullYear() === y;
    const acts = actMap[d] || [];
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayLabel = isToday
      ? `<span class="today-day-marker cursor-pointer hover:opacity-80" title="Ver actividades del día" onclick="abrirModalVerDiaDesdeCalendario('${dateStr}')">${d}</span>`
      : `<span class="day-num text-zinc-400 cursor-pointer hover:text-white" title="Ver actividades del día" onclick="abrirModalVerDiaDesdeCalendario('${dateStr}')">${d}</span>`;
    cells += `
      <div data-date="${dateStr}" ondragover="onCalendarDayDragOver(event)" ondragenter="onCalendarDayDragEnter(event)" ondragleave="onCalendarDayDragLeave(event)" ondrop="onCalendarDayDrop(event, '${dateStr}')" class="cal-day-cell border border-zinc-800 p-2 text-sm hover:bg-[#202020] transition relative min-h-[7rem] flex flex-col group ${isToday ? 'today-cell' : ''} ${acts.length ? 'cal-day-has-events' : ''}">
        <div class="cal-day-header shrink-0 mb-1 flex items-center justify-between">
          ${dayLabel}
          <button type="button" onclick="event.stopPropagation(); abrirModalConFecha('${dateStr}')" class="cal-day-add-btn opacity-0 group-hover:opacity-100 transition text-zinc-400 hover:text-blue-300 border border-zinc-600 hover:border-blue-400 rounded-lg w-7 h-7 flex items-center justify-center text-lg font-light leading-none" title="Agregar actividad">+</button>
        </div>
        ${renderCalendarActivityDots(acts)}
        <div class="cal-day-acts cal-day-acts--desktop flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-0.5 min-h-0">
          ${acts.map(a => renderCalendarActivityCard(a)).join('')}
        </div>
      </div>
    `;
  }
  grid.innerHTML = cells;
}
function prevMonth() { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderCalendar(); }
function nextMonth() { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderCalendar(); }

// ─── BANNER EDITING ──────────────────────────────────────────────────────────

async function handleBannerUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Selecciona un archivo de imagen válido.');
    event.target.value = '';
    return;
  }
  const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
  const statusEl = document.getElementById('banner-upload-status');
  if (statusEl) {
    statusEl.textContent = isGif ? '⏳ Subiendo GIF...' : '⏳ Subiendo imagen...';
    statusEl.classList.remove('hidden');
    statusEl.className = 'text-xs text-blue-400 text-center';
  }
  try {
    const result = await uploadToCloudinary(file);
    const displayUrl = buildCloudinaryDisplayUrl(result.public_id);
    state.settings.heroImage = result.secure_url || displayUrl;
    state.settings.heroImageFallback = displayUrl;
    state.settings.heroImagePos = 50;
    persistAndSync();
    renderApp();
    if (statusEl) {
      statusEl.textContent = isGif ? '✅ GIF subido correctamente' : '✅ Imagen subida correctamente';
      statusEl.className = 'text-xs text-emerald-400 text-center';
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    }
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    if (statusEl) {
      statusEl.textContent = getCloudinaryErrorMessage(err);
      statusEl.className = 'text-xs text-red-400 text-center';
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    }
  }
  event.target.value = '';
}

let isRepositioning = false;
let tempHeroImagePos = 50;
let isDragging = false;
let startY = 0;
let startPosPercent = 50;
let bannerMenuCloseListener = null;

function enterRepositionMode() {
  isRepositioning = true;
  tempHeroImagePos = state.settings.heroImagePos || 50;
  renderApp();
}

function saveRepositionedPos() {
  state.settings.heroImagePos = tempHeroImagePos;
  isRepositioning = false;
  persistAndSync();
  renderApp();
}

function cancelReposition() {
  isRepositioning = false;
  renderApp();
}

function updateBannerPos(val) {
  const container = document.getElementById('hero-banner-container');
  const num = Number(val);
  if (container) container.style.backgroundPosition = `center ${num}%`;
  tempHeroImagePos = num;
  state.settings.heroImagePos = num;
}

function saveBannerPos(val) {
  state.settings.heroImagePos = Number(val);
  persistAndSync();
}

function removeBannerImage() {
  state.settings.heroImage = '';
  state.settings.heroImageFallback = '';
  state.settings.heroImagePos = 50;
  persistAndSync();
  renderApp();
}

function toggleBannerMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('banner-options-menu');
  if (!menu) return;

  const isHidden = menu.classList.contains('hidden');
  
  if (bannerMenuCloseListener) {
    document.removeEventListener('click', bannerMenuCloseListener);
    bannerMenuCloseListener = null;
  }

  if (isHidden) {
    menu.classList.remove('hidden');
    bannerMenuCloseListener = (e) => {
      if (menu && !menu.contains(e.target)) {
        menu.classList.add('hidden');
        document.removeEventListener('click', bannerMenuCloseListener);
        bannerMenuCloseListener = null;
      }
    };
    setTimeout(() => {
      if (!menu.classList.contains('hidden')) {
        document.addEventListener('click', bannerMenuCloseListener);
      }
    }, 0);
  } else {
    menu.classList.add('hidden');
  }
}

function closeBannerMenu() {
  const menu = document.getElementById('banner-options-menu');
  if (menu) {
    menu.classList.add('hidden');
  }
  if (bannerMenuCloseListener) {
    document.removeEventListener('click', bannerMenuCloseListener);
    bannerMenuCloseListener = null;
  }
}

function toggleBannerSliderPanel(event) {
  event.stopPropagation(); // evita cerrar el menú al hacer click en el botón
  const panel = document.getElementById('banner-slider-inline-panel');
  const chevron = document.getElementById('icon-reposicionar-chevron');
  if (!panel) return;

  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    panel.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    // Sincronizar el valor del slider con la posición actual
    const slider = document.getElementById('hero-banner-slider');
    if (slider) slider.value = state.settings.heroImagePos || 50;
  } else {
    panel.classList.add('hidden');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

function togglePanelBody(panelId, iconId) {
  const panel = document.getElementById(panelId);
  const icon = document.getElementById(iconId);
  if (!panel || !icon) return;
  const isHidden = panel.classList.toggle('hidden');
  icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

// ─── RENDER APP ──────────────────────────────────────────────────────────────
function renderApp() {
  document.getElementById('app').innerHTML = `

    <!-- HERO -->
    <div class="relative rounded-3xl border border-zinc-800 animate-in group">
      ${(state.settings.heroImage || '').trim() ? `
        <div id="hero-banner-container"
             class="relative w-full h-56 rounded-3xl overflow-hidden"
             style="${cloudinaryBackgroundStyle(state.settings.heroImage, { position: `center ${state.settings.heroImagePos ?? 50}%` })}"
             role="img"
             aria-label="Banner del dashboard"></div>
      ` : `
        <div class="hero-gradient h-56 flex items-center justify-center rounded-3xl">
          <div class="text-center space-y-3 relative z-10 p-6 rounded-2xl">
            <div class="text-7xl">🎓</div>
            <h1 class="text-4xl md:text-5xl font-extrabold tracking-tight">Escuela</h1>
            <p class="text-indigo-300 text-sm">Dashboard estudiantil · Semestre 2026</p>
          </div>
        </div>
      `}

      <!-- Upload Status -->
      <p id="banner-upload-status" class="hidden text-xs text-center mt-2"></p>

      <!-- Controles de Edición de Banner (lápiz con menú flotante) -->
      ${(state.settings.heroImage || '').trim() ? `
        <div class="absolute top-4 right-4 flex flex-col items-end opacity-0 group-hover:opacity-100 transition-opacity z-20" id="banner-controls-wrapper">
          <!-- Botón de Lápiz SVG -->
          <button onclick="toggleBannerMenu(event)" class="bg-[#1e1e1e]/90 hover:bg-[#2a2a2a]/95 border border-zinc-800 text-zinc-300 hover:text-white w-8 h-8 rounded-xl flex items-center justify-center transition shadow-lg cursor-pointer" title="Opciones de portada">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          
          <!-- Pantallita Flotante de Opciones (Slide-down) -->
          <div id="banner-options-menu" class="absolute right-0 top-11 bg-[#161616]/95 backdrop-blur-lg border border-zinc-800 rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1 z-30 hidden w-52 slide-down">
            
            <!-- Cambiar imagen -->
            <button onclick="document.getElementById('banner-upload-file').click(); closeBannerMenu();" class="hover:bg-zinc-800/80 text-zinc-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2.5 w-full text-left cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              Cambiar imagen
            </button>

            <!-- Reposicionar -->
            <button id="btn-reposicionar-banner" onclick="toggleBannerSliderPanel(event)" class="hover:bg-zinc-800/80 text-zinc-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center justify-between gap-2.5 w-full text-left cursor-pointer">
              <span class="flex items-center gap-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
                </svg>
                Reposicionar
              </span>
              <svg id="icon-reposicionar-chevron" xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-zinc-500 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            <!-- Panel inline del slider (oculto por defecto) -->
            <div id="banner-slider-inline-panel" class="hidden px-3 pb-3 pt-1">
              <div class="flex items-center gap-3 bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2.5">
                <span class="text-zinc-500 text-[10px] select-none font-bold">▲</span>
                <div class="flex-1 flex items-center">
                  <input type="range"
                         id="hero-banner-slider"
                         min="0"
                         max="100"
                         value="${state.settings.heroImagePos || 50}"
                         class="w-full"
                         style="accent-color: #3b82f6; cursor: pointer;"
                         oninput="updateBannerPos(this.value)"
                         onchange="saveBannerPos(this.value)" />
                </div>
                <span class="text-zinc-500 text-[10px] select-none font-bold">▼</span>
              </div>
            </div>

            <div class="h-px bg-zinc-800 mx-1 my-0.5"></div>

            <!-- Quitar portada -->
            <button onclick="removeBannerImage(); closeBannerMenu();" class="hover:bg-red-950/30 text-red-400 hover:text-red-300 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2.5 w-full text-left cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Quitar portada
            </button>
          </div>
        </div>
      ` : `
        <!-- No hero image state -->
        <div class="absolute top-4 right-4 flex items-start gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-20" id="banner-controls-wrapper">
          <button onclick="document.getElementById('banner-upload-file').click()" class="bg-[#1e1e1e]/80 hover:bg-[#2a2a2a] backdrop-blur-md border border-zinc-700 text-zinc-300 p-2 rounded-xl text-sm font-medium transition shadow-lg flex items-center gap-2 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            Subir imagen
          </button>
        </div>
      `}
        <input type="file" id="banner-upload-file" accept="image/*" class="hidden" onchange="handleBannerUpload(event)" />
      </div>
    </div>

    <!-- CURSOS -->
    <section id="panel-cursos" class="dashboard-panel bg-[#181818] border border-zinc-800 rounded-3xl animate-in">
      <div class="panel-header">
        <div class="panel-header-title">
          <button type="button" onclick="togglePanelBody('panel-cursos-body','icon-panel-cursos')" title="Ocultar/mostrar panel" class="panel-toggle-btn bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl transition">
            <svg id="icon-panel-cursos" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-zinc-300 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          <h2 class="panel-header-heading">Cursos</h2>
        </div>
        <div class="panel-header-actions">
          <button onclick="abrirModal('modal-curso')" class="bg-blue-600 hover:bg-blue-500 transition px-4 py-2 rounded-xl text-sm font-medium">+ Nuevo</button>
          <button onclick="abrirModal('modal-ver-cursos')" class="bg-zinc-800 hover:bg-zinc-775 border border-zinc-700 text-zinc-350 hover:text-white transition px-4 py-2 rounded-xl text-sm font-medium">Ver cursos</button>
          <button onclick="abrirTodosCuadernos()" title="Todos los cursos" class="panel-toggle-btn bg-zinc-800 hover:bg-zinc-775 border border-zinc-700 text-zinc-350 hover:text-white transition rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              <path d="M8 7h8"/>
              <path d="M8 11h6"/>
            </svg>
          </button>
        </div>
      </div>
      <div id="panel-cursos-body">
        <div id="courses-grid" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5"></div>
      </div>
    </section>

    <!-- HORARIO -->
    <section id="panel-horario" class="dashboard-panel bg-[#181818] border border-zinc-800 rounded-3xl animate-in">
      <div class="panel-header">
        <div class="panel-header-title">
          <button type="button" onclick="togglePanelBody('panel-horario-body','icon-panel-horario')" title="Ocultar/mostrar panel" class="panel-toggle-btn bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl transition">
            <svg id="icon-panel-horario" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-zinc-300 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          <h2 class="panel-header-heading">Horario Semanal</h2>
        </div>
        <div class="panel-header-actions">
          <button onclick="abrirModal('modal-horario')" class="bg-blue-600 hover:bg-blue-500 transition px-4 py-2 rounded-xl text-sm font-medium">+ Nuevo</button>
          <button onclick="abrirModal('modal-ver-horario')" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white transition px-4 py-2 rounded-xl text-sm font-medium">Ver horario</button>
          <button id="btn-schedule-settings" onclick="abrirModal('modal-ajustes-horario')" class="panel-toggle-btn bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white transition rounded-xl" title="Ajustes del horario">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
      <div id="panel-horario-body" class="overflow-auto mt-2">
        <div id="schedule-grid" class="grid gap-4 min-w-[700px]"></div>
      </div>
    </section>

    <!-- RESUMEN DE ACTIVIDADES -->
    <section id="panel-actividades" class="dashboard-panel bg-[#181818] border border-zinc-800 rounded-3xl animate-in">
      <div class="panel-header">
        <div class="panel-header-title">
          <button type="button" onclick="togglePanelBody('panel-actividades-body','icon-panel-actividades')" title="Ocultar/mostrar panel" class="panel-toggle-btn bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl transition">
            <svg id="icon-panel-actividades" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-zinc-300 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          <h3 class="panel-header-heading panel-header-heading--sm">Resumen de Actividades</h3>
        </div>
        <div class="panel-header-actions">
          <button onclick="abrirModal('modal-actividad')" class="bg-blue-600 hover:bg-blue-500 transition px-4 py-2 rounded-xl text-sm font-medium">+ Nueva</button>
          <button onclick="abrirModal('modal-historial')" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white transition px-4 py-2 rounded-xl text-sm font-medium">Historial</button>
        </div>
      </div>
      <div id="panel-actividades-body" class="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <div class="space-y-4">
          <div id="act-stats" class="space-y-3"></div>
          <div class="pt-2 border-t border-zinc-800">
            <h4 class="text-sm text-zinc-400 font-medium mb-3">Leyenda</h4>
            <div class="space-y-2 text-sm leading-none">
              <div class="flex items-center gap-2"><span class="w-6 h-6 flex items-center justify-center">🍀</span> Más de 3 días</div>
              <div class="flex items-center gap-2"><span class="w-6 h-6 flex items-center justify-center">🌕</span> Menos de 3 días</div>
              <div class="flex items-center gap-2"><span class="w-6 h-6 flex items-center justify-center text-red-500 font-bold">⚠</span> Hoy</div>
              <div class="flex items-center gap-2"><span class="w-6 h-6 flex items-center justify-center">💀</span> Vencida</div>
            </div>
          </div>
        </div>
        <div class="space-y-4">
          <div id="act-list" class="space-y-3 max-h-[500px] overflow-y-auto pr-1 border border-zinc-800 rounded-3xl p-4"></div>
        </div>
      </div>
    </section>

    <!-- CALENDARIO -->
    <section id="panel-calendario" class="dashboard-panel bg-[#181818] border border-zinc-800 rounded-3xl animate-in">
      <div class="panel-header panel-header--calendar">
        <div class="panel-header-title">
          <button type="button" onclick="togglePanelBody('panel-calendario-body','icon-panel-calendario')" title="Ocultar/mostrar panel" class="panel-toggle-btn bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white rounded-xl transition">
            <svg id="icon-panel-calendario" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-zinc-300 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          <h2 class="panel-header-heading">Calendario del Semestre</h2>
        </div>
        <div class="panel-header-actions panel-header-actions--calendar">
          <button onclick="prevMonth()" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white transition px-3.5 py-2 rounded-xl text-sm font-medium">←</button>
          <span id="cal-title" class="panel-cal-title font-semibold text-lg text-center"></span>
          <button onclick="nextMonth()" class="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white transition px-3.5 py-2 rounded-xl text-sm font-medium">→</button>
          <button id="btn-calendar-settings" onclick="abrirModal('modal-ajustes-calendario')" class="panel-toggle-btn bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-350 hover:text-white transition rounded-xl flex items-center justify-center" title="Ajustes del calendario">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
      <div id="panel-calendario-body" class="grid grid-cols-7 border border-zinc-800 rounded-2xl overflow-hidden">
        ${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => `<div class="bg-[#202020] border-b border-zinc-800 p-3 text-center text-zinc-400 font-medium text-sm">${d}</div>`).join('')}
        <div id="cal-grid" class="contents"></div>
      </div>
    </section>

  `;

  renderCourses();
  renderSchedule();
  renderActivities();
  renderCalendar();
  renderColorPicker();
  updateActSelect();
  syncSettingsCheckboxes();

  if (repairHeroImageUrls()) save();
}
// ─── CUSTOM EMOJI PICKER ──────────────────────────────────────────────────────
const ACADEMIC_EMOJIS = [
  '📚', '📝', '🎓', '🏫', '🏛️', '📖', '✏️', '🎨', '💻', '🧠', '🔬', '🔭', '⚗️', '🧬', '🚀', '🦉',
  '🐍', '🍩', '⏱️', '📅', '💡', '🌟', '✨', '☕', '🎨', '🎭', '🎼', '🧩', '🏆', '🥇', '⚽', '🏀',
  '📐', '🤓', '👾', '🤖', '🐱', '🐶', '🍕', '🥤', '🎒', '💬', '📌', '🔑', '🌈', '🍀', '🎯'
];

let activeEmojiInput = null;

function initEmojiPicker() {
  const isDesktop = !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  let picker = document.getElementById('custom-emoji-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'custom-emoji-picker';
    picker.className = 'hidden absolute z-50 bg-[#1e1e1e] border border-zinc-700 rounded-2xl p-3 shadow-2xl w-64 space-y-2 animate-in fade-in zoom-in-95 duration-150';
    picker.innerHTML = `
      <div class="text-[11px] text-zinc-400 font-bold uppercase tracking-wider px-1 pb-1.5 border-b border-zinc-800 flex justify-between items-center select-none">
        <span>Seleccionar Emoji</span>
        <button onclick="cerrarEmojiPicker()" class="text-zinc-500 hover:text-white transition text-xs">✕</button>
      </div>
      <div class="grid grid-cols-6 gap-1.5 max-h-48 overflow-y-auto pr-1 text-xl select-none pt-1" id="emoji-picker-grid">
      </div>
    `;
    document.body.appendChild(picker);
    const grid = document.getElementById('emoji-picker-grid');
    grid.innerHTML = ACADEMIC_EMOJIS.map(emoji => `
      <button onclick="seleccionarEmoji('${emoji}')" class="hover:bg-zinc-800 rounded-lg p-1.5 transition text-center duration-100 transform hover:scale-110 active:scale-95 flex items-center justify-center">${emoji}</button>
    `).join('');
    document.addEventListener('click', (e) => {
      if (activeEmojiInput && !picker.contains(e.target) && e.target !== activeEmojiInput && !activeEmojiInput.contains(e.target)) {
        cerrarEmojiPicker();
      }
      const typesPanel = document.getElementById('pop-tipos-panel');
      const typesBackdrop = document.getElementById('pop-tipos-backdrop');
      const typesTrigger = document.getElementById('btn-tipos-trigger');
      if (typesPanel && !typesPanel.classList.contains('hidden') && e.target !== typesTrigger && !typesTrigger.contains(e.target) && !typesPanel.contains(e.target)) {
        cerrarPopTipos();
      }
      if (typesBackdrop && !typesBackdrop.classList.contains('hidden') && e.target === typesBackdrop) {
        cerrarPopTipos();
      }
    });
  }
  const inputs = ['curso-emoji'];
  if (!isDesktop) return;
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirEmojiPicker(el);
      });
      el.addEventListener('focus', (e) => {
        e.stopPropagation();
        abrirEmojiPicker(el);
      });
      el.removeAttribute('readonly');
    }
  });
}

function abrirEmojiPicker(inputEl) {
  activeEmojiInput = inputEl;
  const picker = document.getElementById('custom-emoji-picker');
  if (!picker) return;
  const rect = inputEl.getBoundingClientRect();
  picker.style.top = `${rect.bottom + window.scrollY + 6}px`;
  picker.style.left = `${rect.left + window.scrollX}px`;
  picker.classList.remove('hidden');
}

function seleccionarEmoji(emoji) {
  if (activeEmojiInput) {
    activeEmojiInput.value = emoji;
    activeEmojiInput.dispatchEvent(new Event('input'));
  }
  cerrarEmojiPicker();
}

function cerrarEmojiPicker() {
  const picker = document.getElementById('custom-emoji-picker');
  if (picker) {
    picker.classList.add('hidden');
  }
  activeEmojiInput = null;
}