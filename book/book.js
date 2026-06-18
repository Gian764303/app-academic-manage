//firebase version of the book app, with Google auth and cloud sync. Uses a guest UID if not logged in, but allows logging in to sync across devices and share with others.

import { Editor, Extension } from 'https://esm.sh/@tiptap/core@2.11.5';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.11.5';
import Underline from 'https://esm.sh/@tiptap/extension-underline@2.11.5';
import TextStyle from 'https://esm.sh/@tiptap/extension-text-style@2.11.5';
import FontFamily from 'https://esm.sh/@tiptap/extension-font-family@2.11.5';
import Image from 'https://esm.sh/@tiptap/extension-image@2.11.5';
import Table from 'https://esm.sh/@tiptap/extension-table@2.11.5';
import TableRow from 'https://esm.sh/@tiptap/extension-table-row@2.11.5';
import TableCell from 'https://esm.sh/@tiptap/extension-table-cell@2.11.5';
import TableHeader from 'https://esm.sh/@tiptap/extension-table-header@2.11.5';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@2.11.5';
import { Plugin, PluginKey } from 'https://esm.sh/@tiptap/pm@2.11.5/state';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth } from '../js/firebase-config.js';
import TextAlign from 'https://esm.sh/@tiptap/extension-text-align@2.11.5';
import Heading from 'https://esm.sh/@tiptap/extension-heading@2.11.5';
import CodeBlockLowlight from 'https://esm.sh/@tiptap/extension-code-block-lowlight@2.11.5';
import {
  lowlight,
  scheduleCodeBlockLanguageDetection,
  detectCodeBlockLanguages,
  flushCodeBlockLanguageDetection,
  createCodeBlockLanguagePlugin,
} from './highlight-setup.js?v=9';
import { ClickToWrite, setSkipTrailingInsert } from './click-to-write.js?v=4';
import { fetchBook, saveBook, subscribeBook } from '../js/book-service.js';
import { fetchUserDashboard, saveUserDashboard } from '../js/data-service.js';
import {
  HEADLESS_BUTTONS,
  runHeadlessCommand,
  canRunHeadlessCommand,
  isHeadlessCommandActive,
  isClearFormatCmd,
  lockAllBroomButtons,
  runToolbarAction,
} from './headless-commands.js?v=9';

lockAllBroomButtons();

const isCoursesHub = document.documentElement.dataset.bookMode === 'courses-hub';

const CLOUDINARY_CLOUD_NAME = 'db3hacpfx';
const CLOUDINARY_UPLOAD_PRESET = 'app-school-img';

const params = new URLSearchParams(window.location.search);
let courseId = params.get('courseId');
let courseTitle = params.get('title') || (isCoursesHub ? 'Curso' : 'Cuaderno');
let courseEmoji = params.get('emoji') || (isCoursesHub ? '📚' : '📓');
const initialPageId = params.get('pageId');

let hubCourses = [];
let hubDashboard = null;

const els = {
  loading: document.getElementById('book-loading'),
  app: document.getElementById('book-app'),
  editorMount: document.getElementById('editor'),
  toolbar: document.getElementById('headless-toolbar-main'),
  title: document.getElementById('book-title'),
  emoji: document.getElementById('book-emoji'),
  sync: document.getElementById('book-sync-status'),
  imageInput: document.getElementById('book-image-input'),
  slashMenu: document.getElementById('slash-menu'),
  pagesList: document.getElementById('book-pages-list'),
  pageAdd: document.getElementById('book-page-add'),
  pageMenu: document.getElementById('book-page-menu'),
  bookBody: document.querySelector('.book-body'),
  sidebarToggle: document.getElementById('book-sidebar-toggle'),
  coursesList: document.getElementById('courses-list'),
  courseMenu: document.getElementById('book-course-menu'),
};

let menuPageId = null;
let dragPageId = null;
let dragRowEl = null;
let dragOverRowEl = null;
let menuCourseId = null;
let dragCourseId = null;
let dragCourseRowEl = null;
let dragOverCourseRowEl = null;

const PAGE_GRIP_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/></svg>';

let editor = null;
const editorRef = { current: null };
let currentUid = null;
let saveTimer = null;
let unsubBook = null;
let applyingRemote = false;
let saveInFlight = false;
let lastLocalSaveAt = 0;
let lastSavedJson = '';
let pendingSaveJson = '';
let lastSavedBookJson = '';
let pendingSaveBookJson = '';
let bookState = { pages: [], activePageId: null };

const SLASH_ITEMS = [
  { id: 'p', label: 'Texto', hint: 'Párrafo', icon: '¶', run: (ed) => ed.chain().focus().setParagraph().run() },
  { id: 'h1', label: 'Título 1', hint: 'H1', icon: 'H1', run: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Título 2', hint: 'H2', icon: 'H2', run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Título 3', hint: 'H3', icon: 'H3', run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: 'h4', label: 'Título 4', hint: 'H4', icon: 'H4', run: (ed) => ed.chain().focus().toggleHeading({ level: 4 }).run() },
  { id: 'h5', label: 'Título 5', hint: 'H5', icon: 'H5', run: (ed) => ed.chain().focus().toggleHeading({ level: 5 }).run() },
  { id: 'h6', label: 'Título 6', hint: 'H6', icon: 'H6', run: (ed) => ed.chain().focus().toggleHeading({ level: 6 }).run() },
  { id: 'bullet', label: 'Lista', hint: 'Viñetas', icon: '•', run: (ed) => ed.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: 'Numerada', hint: '1, 2, 3…', icon: '1.', run: (ed) => ed.chain().focus().toggleOrderedList().run() },
  { id: 'quote', label: 'Cita', hint: 'Blockquote', icon: '❝', run: (ed) => ed.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: 'Código', hint: 'Cascadia Code', icon: '</>', run: (ed) => ed.chain().focus().toggleCodeBlock().run() },
  { id: 'hr', label: 'Separador', hint: 'Línea horizontal', icon: '—', run: (ed) => ed.chain().focus().setHorizontalRule().run() },
  { id: 'table', label: 'Tabla', hint: '3×3 con encabezado', icon: '⊞', run: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'image', label: 'Imagen', hint: 'Cloudinary', icon: '🖼', run: () => els.imageInput?.click() },
];

const slashPluginKey = new PluginKey('slashCommand');

const SYNC_ICON_SYNC = `<svg class="book-sync-icon book-sync-icon--spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;

const SYNC_ICON_CHECK = `<svg class="book-sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

const SYNC_ICON_ERROR = `<svg class="book-sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

function setSyncStatus(mode, label) {
  if (!els.sync) return;
  els.sync.className = `book-sync ${mode}`;
  if (mode === 'saving') {
    els.sync.innerHTML = SYNC_ICON_SYNC;
  } else if (mode === 'error') {
    els.sync.innerHTML = SYNC_ICON_ERROR;
  } else {
    els.sync.innerHTML = SYNC_ICON_CHECK;
  }
  const text = label || '';
  els.sync.setAttribute('aria-label', text);
  if (text) {
    els.sync.title = text;
  } else {
    els.sync.removeAttribute('title');
  }
}

function isOldDefaultContent(content) {
  if (!content || content.type !== 'doc' || !Array.isArray(content.content)) return false;

  const isPlaceholderText = (node, expected) =>
    node?.type === 'text' && node.text === expected;

  const headingWith = (block, level, text) =>
    block?.type === 'heading' &&
    block?.attrs?.level === level &&
    Array.isArray(block.content) &&
    block.content.length === 1 &&
    isPlaceholderText(block.content[0], text);

  const paragraphWith = (block, text) =>
    block?.type === 'paragraph' &&
    Array.isArray(block.content) &&
    block.content.length === 1 &&
    isPlaceholderText(block.content[0], text);

  const [first, second, third] = content.content;

  if (headingWith(first, 2, 'Título') && paragraphWith(second, 'Empieza a escribir...')) return true;
  if (headingWith(first, 1, 'Título') && headingWith(second, 3, 'Empieza a escribir...')) return true;
  if (headingWith(first, 2, 'Título') && paragraphWith(second, 'Empieza a escribir...') && third?.type === 'paragraph' && !third.content?.length) return true;

  return false;
}

function createEmptyPageContent() {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 } },
      { type: 'paragraph' },
    ],
  };
}

function ensureLeadBlocks(content) {
  if (!content || content.type !== 'doc') return createEmptyPageContent();
  const blocks = [...(content.content || [])];
  if (!blocks.length || blocks[0]?.type !== 'heading') {
    blocks.unshift({ type: 'heading', attrs: { level: 2 } });
  }
  if (blocks.length < 2 || blocks[1]?.type !== 'paragraph') {
    blocks.splice(1, 0, { type: 'paragraph' });
  }
  return { type: 'doc', content: blocks };
}

function createPage(title, content = null) {
  return {
    id: crypto.randomUUID(),
    title,
    content: content && !isOldDefaultContent(content) ? content : createEmptyPageContent(),
  };
}

function getRemoteUpdatedAtMs(data) {
  const ts = data?.updatedAt;
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') {
    return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
  }
  return 0;
}

function normalizeBookData(data) {
  if (!data) {
    const page = createPage('Página 1');
    return { pages: [page], activePageId: page.id };
  }
  if (Array.isArray(data.pages) && data.pages.length) {
    const pages = data.pages.map((p, i) => ({
      id: p.id || crypto.randomUUID(),
      title: p.title || `Página ${i + 1}`,
      content: p.content && !isOldDefaultContent(p.content) ? p.content : createEmptyPageContent(),
    }));
    const activePageId = pages.some((p) => p.id === data.activePageId)
      ? data.activePageId
      : pages[0].id;
    return { pages, activePageId };
  }
  if (data.content && !isOldDefaultContent(data.content)) {
    const page = createPage('Página 1', data.content);
    return { pages: [page], activePageId: page.id };
  }
  const page = createPage('Página 1');
  return { pages: [page], activePageId: page.id };
}

function getActivePage() {
  return bookState.pages.find((p) => p.id === bookState.activePageId) || bookState.pages[0] || null;
}

function persistCurrentPage() {
  if (!editor || !bookState.activePageId) return;
  const page = bookState.pages.find((p) => p.id === bookState.activePageId);
  if (!page) return;
  if (!applyingRemote) flushCodeBlockLanguageDetection(editor);
  page.content = editor.getJSON();
}

function getCurrentCourseMeta() {
  if (!isCoursesHub) return { title: courseTitle, emoji: courseEmoji };
  const course = hubCourses.find((c) => String(c.id) === String(courseId));
  return { title: course?.title || 'Curso', emoji: course?.emoji || '📚' };
}

function updateCourseHeader() {
  const meta = getCurrentCourseMeta();
  if (els.title) els.title.textContent = meta.title;
  if (els.emoji) els.emoji.textContent = meta.emoji;
  const subtitle = document.getElementById('book-subtitle');
  if (subtitle && isCoursesHub) subtitle.textContent = 'Curso activo';
}

function getBookPayload() {
  const meta = getCurrentCourseMeta();
  return {
    pages: bookState.pages,
    activePageId: bookState.activePageId,
    courseTitle: meta.title,
    courseEmoji: meta.emoji,
  };
}

function getBookStateJson() {
  return JSON.stringify({ pages: bookState.pages, activePageId: bookState.activePageId });
}

function getLocalBookJson() {
  if (!editor) return getBookStateJson();
  const activeId = bookState.activePageId;
  const liveContent = editor.getJSON();
  return JSON.stringify({
    pages: bookState.pages.map((p) =>
      p.id === activeId ? { ...p, content: liveContent } : p
    ),
    activePageId: activeId,
  });
}

function clearRowMenuOpen() {
  document.querySelectorAll('.book-page-row.is-menu-open').forEach((row) => {
    row.classList.remove('is-menu-open');
  });
}

function setRowMenuOpen(row) {
  clearRowMenuOpen();
  row?.classList.add('is-menu-open');
}

function openPageMenu(pageId, anchor) {
  closePageMenu();
  menuPageId = pageId;
  const pop = els.pageMenu;
  if (!pop || !anchor) return;
  setRowMenuOpen(anchor.closest('.book-page-row'));
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 4}px`;
  pop.style.left = `${Math.max(8, rect.left - 72)}px`;
  pop.classList.remove('hidden');
  const deleteBtn = pop.querySelector('[data-action="delete"]');
  if (deleteBtn) deleteBtn.disabled = bookState.pages.length <= 1;
  setTimeout(() => {
    document.addEventListener('click', onPageMenuOutsideClick, true);
  }, 0);
}

function onPageMenuOutsideClick(e) {
  if (e.target.closest('#book-page-menu')) return;
  closePageMenu();
}

function startPageRename(pageId) {
  const page = bookState.pages.find((p) => p.id === pageId);
  if (!page || !els.pagesList) return;
  const row = els.pagesList.querySelector(`.book-page-row[data-page-id="${pageId}"]`);
  const label = row?.querySelector('.book-page-item');
  if (!label) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'book-page-rename';
  input.value = page.title;
  input.maxLength = 80;

  const finish = (save) => {
    if (save) {
      const title = input.value.trim();
      if (title && title !== page.title) {
        page.title = title;
        scheduleSave();
      }
    }
    renderPagesList();
  };

  label.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      input.value = page.title;
      finish(false);
    }
  });
}

function renamePage(pageId) {
  closePageMenu();
  startPageRename(pageId);
}

function deletePage(pageId) {
  if (bookState.pages.length <= 1) {
    alert('Debe quedar al menos una página.');
    return;
  }
  const page = bookState.pages.find((p) => p.id === pageId);
  if (!page) return;
  if (!confirm(`¿Eliminar "${page.title}"?`)) return;
  persistCurrentPage();
  const idx = bookState.pages.findIndex((p) => p.id === pageId);
  bookState.pages.splice(idx, 1);
  if (bookState.activePageId === pageId) {
    const next = bookState.pages[Math.min(idx, bookState.pages.length - 1)];
    bookState.activePageId = next.id;
    applyingRemote = true;
    editor.commands.setContent(ensureLeadBlocks(next.content), false);
    lastSavedJson = getEditorContentJson();
    applyingRemote = false;
    syncHeadlessToolbar(editor);
    refreshCodeBlockHighlight(editor);
  }
  renderPagesList();
  scheduleSave();
}

function closePageMenu() {
  menuPageId = null;
  els.pageMenu?.classList.add('hidden');
  clearRowMenuOpen();
  document.removeEventListener('click', onPageMenuOutsideClick, true);
}

function movePage(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const fromIdx = bookState.pages.findIndex((p) => p.id === fromId);
  const toIdx = bookState.pages.findIndex((p) => p.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = bookState.pages.splice(fromIdx, 1);
  bookState.pages.splice(toIdx, 0, moved);
  renderPagesList();
  scheduleSave();
}

function onPageDragMove(e) {
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.book-page-row');
  els.pagesList?.querySelectorAll('.book-page-row.is-drag-over').forEach((el) => {
    if (el !== over) el.classList.remove('is-drag-over');
  });
  if (over && over.dataset.pageId !== dragPageId) {
    over.classList.add('is-drag-over');
    dragOverRowEl = over;
  } else {
    dragOverRowEl = null;
  }
}

function endPageDrag(e) {
  window.removeEventListener('pointermove', onPageDragMove);
  window.removeEventListener('pointerup', endPageDrag);
  window.removeEventListener('pointercancel', endPageDrag);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  const targetId =
    dragOverRowEl?.dataset.pageId ||
    document.elementFromPoint(e.clientX, e.clientY)?.closest('.book-page-row')?.dataset.pageId;

  if (dragPageId && targetId && targetId !== dragPageId) {
    movePage(dragPageId, targetId);
  } else {
    dragRowEl?.classList.remove('is-dragging');
    els.pagesList?.querySelectorAll('.book-page-row.is-drag-over').forEach((el) => {
      el.classList.remove('is-drag-over');
    });
  }

  dragPageId = null;
  dragRowEl = null;
  dragOverRowEl = null;
}

function startPageDrag(e, pageId, row) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  dragPageId = pageId;
  dragRowEl = row;
  dragOverRowEl = null;
  row.classList.add('is-dragging');
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'grabbing';
  window.addEventListener('pointermove', onPageDragMove);
  window.addEventListener('pointerup', endPageDrag);
  window.addEventListener('pointercancel', endPageDrag);
}

function renderPagesList() {
  if (!els.pagesList) return;
  closePageMenu();
  els.pagesList.innerHTML = '';
  bookState.pages.forEach((p) => {
    const row = document.createElement('div');
    row.className = `book-page-row${p.id === bookState.activePageId ? ' is-active' : ''}`;
    row.dataset.pageId = p.id;

    const drag = document.createElement('button');
    drag.type = 'button';
    drag.className = 'book-page-drag';
    drag.title = 'Arrastrar para reordenar';
    drag.setAttribute('aria-label', 'Arrastrar página');
    drag.innerHTML = PAGE_GRIP_ICON;
    drag.addEventListener('pointerdown', (e) => startPageDrag(e, p.id, row));

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'book-page-item';
    label.title = p.title;
    const labelText = document.createElement('span');
    labelText.className = 'book-page-item-text';
    labelText.textContent = p.title || 'Sin título';
    label.append(labelText);
    label.addEventListener('click', () => switchPage(p.id));
    label.addEventListener('dblclick', (e) => {
      e.preventDefault();
      startPageRename(p.id);
    });

    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'book-page-menu';
    menu.title = 'Opciones de página';
    menu.setAttribute('aria-label', 'Opciones de página');
    menu.textContent = '⋯';
    menu.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menuPageId === p.id && !els.pageMenu?.classList.contains('hidden')) {
        closePageMenu();
      } else {
        openPageMenu(p.id, menu);
      }
    });

    row.append(drag, label, menu);
    els.pagesList.append(row);
  });
}

function refreshCodeBlockHighlight(ed = editor) {
  if (!ed || ed.isDestroyed) return;
  detectCodeBlockLanguages(ed);
}

function switchPage(pageId) {
  if (!pageId || pageId === bookState.activePageId || !editor) return;
  persistCurrentPage();
  bookState.activePageId = pageId;
  const page = getActivePage();
  if (!page) return;
  applyingRemote = true;
  editor.commands.setContent(ensureLeadBlocks(page.content), false);
  lastSavedJson = getEditorContentJson();
  applyingRemote = false;
  renderPagesList();
  syncHeadlessToolbar(editor);
  refreshCodeBlockHighlight(editor);
  editor.commands.focus('end');
  scheduleSave();
  closeMobileSidebars();
}

function addPage() {
  persistCurrentPage();
  const page = createPage(`Página ${bookState.pages.length + 1}`);
  bookState.pages.push(page);
  switchPage(page.id);
}

function initPageMenu() {
  els.pageMenu?.querySelector('[data-action="rename"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = menuPageId;
    closePageMenu();
    if (id) startPageRename(id);
  });
  els.pageMenu?.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = menuPageId;
    closePageMenu();
    if (id) deletePage(id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePageMenu();
  });
}

function initPagesSidebar() {
  els.pageAdd?.addEventListener('click', addPage);
  initPageMenu();
  initCourseMenu();
  initSidebarToggle();
  renderPagesList();
}

function renderCoursesList() {
  if (!isCoursesHub || !els.coursesList) return;
  closeCourseMenu();
  els.coursesList.innerHTML = '';
  if (!hubCourses.length) {
    els.coursesList.innerHTML = '<p class="sidebar-empty">No hay cursos. Crea uno en el dashboard.</p>';
    return;
  }
  hubCourses.forEach((course) => {
    const id = String(course.id);
    const row = document.createElement('div');
    row.className = `book-page-row${String(courseId) === id ? ' is-active' : ''}`;
    row.dataset.courseId = id;

    const drag = document.createElement('button');
    drag.type = 'button';
    drag.className = 'book-page-drag';
    drag.title = 'Arrastrar para reordenar';
    drag.setAttribute('aria-label', 'Arrastrar curso');
    drag.innerHTML = PAGE_GRIP_ICON;
    drag.addEventListener('pointerdown', (e) => startCourseDrag(e, id, row));

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'book-page-item';
    label.title = course.title || 'Curso';
    const labelText = document.createElement('span');
    labelText.className = 'book-page-item-text';
    labelText.textContent = course.title || 'Sin título';
    label.append(labelText);
    label.addEventListener('click', () => switchCourse(id));
    label.addEventListener('dblclick', (e) => {
      e.preventDefault();
      startCourseRename(id);
    });

    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'book-page-menu';
    menu.title = 'Opciones de curso';
    menu.setAttribute('aria-label', 'Opciones de curso');
    menu.textContent = '⋯';
    menu.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menuCourseId === id && !els.courseMenu?.classList.contains('hidden')) {
        closeCourseMenu();
      } else {
        openCourseMenu(id, menu);
      }
    });

    row.append(drag, label, menu);
    els.coursesList.append(row);
  });
}

async function persistHubCourses() {
  if (!hubDashboard || !currentUid) return;
  const hidden = (hubDashboard.courses || []).filter((c) => c.hidden);
  hubDashboard.courses = [...hubCourses, ...hidden];
  await saveUserDashboard(currentUid, hubDashboard);
}

function closeCourseMenu() {
  menuCourseId = null;
  els.courseMenu?.classList.add('hidden');
  clearRowMenuOpen();
  document.removeEventListener('click', onCourseMenuOutsideClick, true);
}

function openCourseMenu(courseIdVal, anchor) {
  closeCourseMenu();
  menuCourseId = courseIdVal;
  const pop = els.courseMenu;
  if (!pop || !anchor) return;
  setRowMenuOpen(anchor.closest('.book-page-row'));
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 4}px`;
  pop.style.left = `${Math.max(8, rect.left - 72)}px`;
  pop.classList.remove('hidden');
  const deleteBtn = pop.querySelector('[data-action="delete"]');
  if (deleteBtn) deleteBtn.disabled = hubCourses.length <= 1;
  setTimeout(() => {
    document.addEventListener('click', onCourseMenuOutsideClick, true);
  }, 0);
}

function onCourseMenuOutsideClick(e) {
  if (e.target.closest('#book-course-menu')) return;
  closeCourseMenu();
}

function startCourseRename(courseIdVal) {
  const course = hubCourses.find((c) => String(c.id) === String(courseIdVal));
  if (!course || !els.coursesList) return;
  const row = els.coursesList.querySelector(`.book-page-row[data-course-id="${courseIdVal}"]`);
  const label = row?.querySelector('.book-page-item');
  if (!label) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'book-page-rename';
  input.value = course.title;
  input.maxLength = 80;

  const finish = async (save) => {
    if (save) {
      const title = input.value.trim();
      if (title && title !== course.title) {
        course.title = title;
        await persistHubCourses();
        if (String(courseId) === String(courseIdVal)) updateCourseHeader();
      }
    }
    renderCoursesList();
  };

  label.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      input.value = course.title;
      finish(false);
    }
  });
}

async function deleteCourse(courseIdVal) {
  if (hubCourses.length <= 1) {
    alert('Debe quedar al menos un curso.');
    return;
  }
  const course = hubCourses.find((c) => String(c.id) === String(courseIdVal));
  if (!course) return;
  if (!confirm(`¿Eliminar el curso "${course.title}"?`)) return;

  await saveNow();
  const idx = hubCourses.findIndex((c) => String(c.id) === String(courseIdVal));
  hubCourses.splice(idx, 1);
  hubDashboard.courses = hubDashboard.courses.filter((c) => String(c.id) !== String(courseIdVal));
  await saveUserDashboard(currentUid, hubDashboard);

  if (String(courseId) === String(courseIdVal)) {
    const next = hubCourses[Math.min(idx, hubCourses.length - 1)];
    if (next) await switchCourse(String(next.id));
  } else {
    renderCoursesList();
  }
}

function moveCourse(fromId, toId) {
  if (!fromId || !toId || String(fromId) === String(toId)) return;
  const fromIdx = hubCourses.findIndex((c) => String(c.id) === String(fromId));
  const toIdx = hubCourses.findIndex((c) => String(c.id) === String(toId));
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = hubCourses.splice(fromIdx, 1);
  hubCourses.splice(toIdx, 0, moved);
  renderCoursesList();
  persistHubCourses();
}

function onCourseDragMove(e) {
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.book-page-row[data-course-id]');
  els.coursesList?.querySelectorAll('.book-page-row.is-drag-over').forEach((el) => {
    if (el !== over) el.classList.remove('is-drag-over');
  });
  if (over && over.dataset.courseId !== dragCourseId) {
    over.classList.add('is-drag-over');
    dragOverCourseRowEl = over;
  } else {
    dragOverCourseRowEl = null;
  }
}

function endCourseDrag(e) {
  window.removeEventListener('pointermove', onCourseDragMove);
  window.removeEventListener('pointerup', endCourseDrag);
  window.removeEventListener('pointercancel', endCourseDrag);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  const targetId =
    dragOverCourseRowEl?.dataset.courseId ||
    document.elementFromPoint(e.clientX, e.clientY)?.closest('.book-page-row[data-course-id]')?.dataset.courseId;

  if (dragCourseId && targetId && targetId !== dragCourseId) {
    moveCourse(dragCourseId, targetId);
  } else {
    dragCourseRowEl?.classList.remove('is-dragging');
    els.coursesList?.querySelectorAll('.book-page-row.is-drag-over').forEach((el) => {
      el.classList.remove('is-drag-over');
    });
  }

  dragCourseId = null;
  dragCourseRowEl = null;
  dragOverCourseRowEl = null;
}

function startCourseDrag(e, courseIdVal, row) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  dragCourseId = courseIdVal;
  dragCourseRowEl = row;
  dragOverCourseRowEl = null;
  row.classList.add('is-dragging');
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'grabbing';
  window.addEventListener('pointermove', onCourseDragMove);
  window.addEventListener('pointerup', endCourseDrag);
  window.addEventListener('pointercancel', endCourseDrag);
}

function initCourseMenu() {
  if (!isCoursesHub) return;
  els.courseMenu?.querySelector('[data-action="rename"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = menuCourseId;
    closeCourseMenu();
    if (id) startCourseRename(id);
  });
  els.courseMenu?.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = menuCourseId;
    closeCourseMenu();
    if (id) deleteCourse(id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCourseMenu();
  });
}

async function saveNow() {
  if (!editor || !currentUid || !courseId || applyingRemote || saveInFlight) return;
  clearTimeout(saveTimer);
  persistCurrentPage();
  const bookJson = getBookStateJson();
  if (!bookJson || bookJson === lastSavedBookJson) return;
  saveInFlight = true;
  try {
    await saveBook(currentUid, courseId, getBookPayload());
    persistCurrentPage();
    lastSavedBookJson = getBookStateJson();
    lastSavedJson = getEditorContentJson();
    lastLocalSaveAt = Date.now();
    pendingSaveBookJson = '';
    pendingSaveJson = '';
    setSyncStatus('saved', 'Guardado');
  } catch (err) {
    console.error(err);
    setSyncStatus('error', 'Error al guardar');
  } finally {
    saveInFlight = false;
  }
}

async function switchCourse(newCourseId) {
  if (!isCoursesHub || !editor || String(newCourseId) === String(courseId)) return;
  setSyncStatus('saving', 'Cambiando curso…');
  await saveNow();
  if (unsubBook) {
    unsubBook();
    unsubBook = null;
  }
  courseId = String(newCourseId);
  let data = null;
  try {
    data = await fetchBook(currentUid, courseId);
    bookState = normalizeBookData(data);
  } catch (err) {
    console.error(err);
    bookState = normalizeBookData(null);
    setSyncStatus('error', 'Error al cargar');
  }
  const page = getActivePage();
  applyingRemote = true;
  editor.commands.setContent(ensureLeadBlocks(page?.content || createEmptyPageContent()), false);
  lastSavedJson = getEditorContentJson();
  lastSavedBookJson = getBookStateJson();
  lastLocalSaveAt = getRemoteUpdatedAtMs(data) || Date.now();
  applyingRemote = false;
  updateCourseHeader();
  renderCoursesList();
  renderPagesList();
  syncHeadlessToolbar(editor);
  refreshCodeBlockHighlight(editor);
  editor.commands.focus('end');
  closeMobileSidebars();
  unsubBook = subscribeBook(
    currentUid,
    courseId,
    (remote) => {
      if (remote) applyRemoteBook(remote);
    },
    (err) => {
      console.error(err);
      setSyncStatus('error', 'Sync desconectada');
    }
  );
  setSyncStatus('saved', 'Listo');
}

function isMobileBookView() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function closeMobileSidebars() {
  els.bookBody?.classList.remove('mobile-courses-open', 'mobile-pages-open');
  document.getElementById('book-sidebar-backdrop')?.classList.remove('is-visible');
}

function toggleMobileDrawer(which) {
  if (!isMobileBookView()) return;
  const openClass = which === 'courses' ? 'mobile-courses-open' : 'mobile-pages-open';
  const isOpen = els.bookBody?.classList.contains(openClass);
  closeMobileSidebars();
  if (!isOpen) {
    els.bookBody?.classList.add(openClass);
    document.getElementById('book-sidebar-backdrop')?.classList.add('is-visible');
  }
}

function ensureMobileBookUI() {
  if (!document.getElementById('book-sidebar-backdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'book-sidebar-backdrop';
    backdrop.className = 'book-sidebar-backdrop';
    backdrop.addEventListener('click', closeMobileSidebars);
    document.body.appendChild(backdrop);
  }

  if (!document.getElementById('book-mobile-nav')) {
    const header = document.querySelector('.book-header');
    const nav = document.createElement('div');
    nav.id = 'book-mobile-nav';
    nav.className = 'book-mobile-nav';
    if (isCoursesHub) {
      nav.innerHTML = `
        <button type="button" id="book-mobile-courses-btn" class="book-mobile-nav-btn">📚 Cursos</button>
        <button type="button" id="book-mobile-pages-btn" class="book-mobile-nav-btn">📄 Páginas</button>
      `;
    } else {
      nav.innerHTML = `<button type="button" id="book-mobile-pages-btn" class="book-mobile-nav-btn">📄 Páginas</button>`;
    }
    header?.insertAdjacentElement('afterend', nav);
    document.getElementById('book-mobile-courses-btn')?.addEventListener('click', () => toggleMobileDrawer('courses'));
    document.getElementById('book-mobile-pages-btn')?.addEventListener('click', () => toggleMobileDrawer('pages'));
  }
}

function initSidebarResizer({ resizer, getTarget, cssVar, storageKey, min, max }) {
  if (!resizer || resizer.dataset.bound === '1') return;
  const target = getTarget();
  if (!target) return;
  resizer.dataset.bound = '1';

  const savedWidth = Number(localStorage.getItem(storageKey));
  if (savedWidth >= min && savedWidth <= max) {
    document.documentElement.style.setProperty(cssVar, `${savedWidth}px`);
  }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  function finishDrag(e) {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('is-dragging');
    document.body.classList.remove('book-sidebar-resizing');
    if (e?.pointerId != null) {
      try { resizer.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
    const width = Math.round(getTarget().getBoundingClientRect().width);
    localStorage.setItem(storageKey, String(width));
  }

  resizer.addEventListener('pointerdown', (e) => {
    if (isMobileBookView()) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = getTarget().getBoundingClientRect().width;
    resizer.classList.add('is-dragging');
    document.body.classList.add('book-sidebar-resizing');
    resizer.setPointerCapture(e.pointerId);
  });

  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const next = Math.max(min, Math.min(max, Math.round(startWidth + dx)));
    document.documentElement.style.setProperty(cssVar, `${next}px`);
  });

  resizer.addEventListener('pointerup', finishDrag);
  resizer.addEventListener('pointercancel', finishDrag);
}

function initHubSidebarResize() {
  if (!isCoursesHub) return;
  initSidebarResizer({
    resizer: document.getElementById('book-hub-resizer'),
    getTarget: () => document.getElementById('courses-sidebar'),
    cssVar: '--courses-sidebar-width',
    storageKey: 'book-hub-courses-width',
    min: 120,
    max: 480,
  });
}

function initPagesSidebarResize() {
  const storageKey = isCoursesHub
    ? 'book-hub-pages-width'
    : `book-pages-width-${courseId || 'default'}`;
  initSidebarResizer({
    resizer: document.getElementById('book-pages-resizer'),
    getTarget: () => document.getElementById('book-sidebar'),
    cssVar: '--pages-sidebar-width',
    storageKey,
    min: 140,
    max: 480,
  });
}

function initSidebarToggle() {
  ensureMobileBookUI();
  initHubSidebarResize();
  initPagesSidebarResize();
  const key = isCoursesHub ? 'book-sidebar-hub' : `book-sidebar-${courseId}`;

  if (isMobileBookView()) {
    setSidebarCollapsed(true);
    closeMobileSidebars();
  } else if (localStorage.getItem(key) === '0') {
    setSidebarCollapsed(true);
  }

  els.sidebarToggle?.addEventListener('click', () => {
    if (isMobileBookView()) {
      toggleMobileDrawer('pages');
      return;
    }
    const collapsed = !els.bookBody?.classList.contains('sidebar-collapsed');
    setSidebarCollapsed(collapsed);
    localStorage.setItem(key, collapsed ? '0' : '1');
  });

  window.addEventListener('resize', () => {
    if (!isMobileBookView()) closeMobileSidebars();
  });
}

function setSidebarCollapsed(collapsed) {
  els.bookBody?.classList.toggle('sidebar-collapsed', collapsed);
  if (els.sidebarToggle) {
    els.sidebarToggle.textContent = collapsed ? '▶' : '◀';
    if (isCoursesHub) {
      els.sidebarToggle.title = collapsed ? 'Mostrar cursos y páginas' : 'Ocultar cursos y páginas';
    } else {
      els.sidebarToggle.title = collapsed ? 'Mostrar páginas' : 'Ocultar páginas';
    }
    els.sidebarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

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
    throw new Error(err.error?.message || 'Error al subir imagen');
  }
  const data = await res.json();
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto,w_1200/${data.public_id}`;
}

function buildSlashPlugin(getEditor) {
  let slashState = null;

  function hideSlashMenu() {
    els.slashMenu?.classList.add('hidden');
    slashState = null;
  }

  function renderSlashMenu(items, selectedIndex, coords) {
    if (!els.slashMenu) return;
    els.slashMenu.innerHTML = items
      .map(
        (item, i) => `
      <button type="button" class="slash-item ${i === selectedIndex ? 'is-selected' : ''}" data-idx="${i}">
        <span class="slash-item-icon">${item.icon}</span>
        <span>
          <span class="slash-item-label">${item.label}</span>
          <span class="slash-item-hint">${item.hint}</span>
        </span>
      </button>`
      )
      .join('');
    els.slashMenu.style.left = `${coords.left}px`;
    els.slashMenu.style.top = `${coords.top}px`;
    els.slashMenu.classList.remove('hidden');
    els.slashMenu.querySelectorAll('.slash-item').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        executeSlashItem(items[Number(btn.dataset.idx)]);
        hideSlashMenu();
      });
    });
  }

  function executeSlashItem(item) {
    const ed = getEditor();
    if (!ed || !item) return;
    const { from } = ed.state.selection;
    const textBefore = ed.state.doc.textBetween(Math.max(0, from - 30), from, '\n');
    const slashPos = textBefore.lastIndexOf('/');
    if (slashPos >= 0) {
      const deleteFrom = from - (textBefore.length - slashPos);
      ed.chain().focus().deleteRange({ from: deleteFrom, to: from }).run();
    }
    item.run(ed);
  }

  return new Plugin({
    key: slashPluginKey,
    props: {
      handleKeyDown(_view, event) {
        if (!slashState) return false;
        const { items, selectedIndex } = slashState;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          slashState.selectedIndex = (selectedIndex + 1) % items.length;
          renderSlashMenu(items, slashState.selectedIndex, slashState.coords);
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          slashState.selectedIndex = (selectedIndex - 1 + items.length) % items.length;
          renderSlashMenu(items, slashState.selectedIndex, slashState.coords);
          return true;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          executeSlashItem(items[selectedIndex]);
          hideSlashMenu();
          return true;
        }
        if (event.key === 'Escape') {
          hideSlashMenu();
          return true;
        }
        return false;
      },
    },
    view() {
      return {
        update(view) {
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(Math.max(0, from - 30), from, '\n');
          const slashMatch = textBefore.match(/(?:^|\s)\/([^\s]*)$/);
          if (!slashMatch) {
            hideSlashMenu();
            return;
          }
          const query = (slashMatch[1] || '').toLowerCase();
          const items = SLASH_ITEMS.filter(
            (it) =>
              it.label.toLowerCase().includes(query) ||
              it.id.includes(query) ||
              it.hint.toLowerCase().includes(query)
          );
          if (!items.length) {
            hideSlashMenu();
            return;
          }
          const coords = view.coordsAtPos(from);
          slashState = {
            items,
            selectedIndex: Math.min(slashState?.selectedIndex ?? 0, items.length - 1),
            coords: { left: coords.left, top: coords.bottom + 6 },
          };
          renderSlashMenu(items, slashState.selectedIndex, slashState.coords);
        },
        destroy: hideSlashMenu,
      };
    },
  });
}

const CodeBlockLanguageLabels = Extension.create({
  name: 'codeBlockLanguageLabels',
  addProseMirrorPlugins() {
    return [createCodeBlockLanguagePlugin()];
  },
});

const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [buildSlashPlugin(() => editorRef.current)];
  },
});

const PROTECTED_LEAD_META = 'protectedLead';

function docNeedsLeadFix(doc) {
  const first = doc.firstChild;
  const second = doc.childCount > 1 ? doc.child(1) : null;
  return !first || first.type.name !== 'heading' || !second || second.type.name !== 'paragraph';
}

function fixLeadBlocks(tr, schema) {
  const heading = schema.nodes.heading;
  const paragraph = schema.nodes.paragraph;
  if (!heading || !paragraph) return tr;

  if (tr.doc.childCount === 0) {
    tr.insert(0, [heading.create({ level: 2 }), paragraph.create()]);
    tr.setMeta(PROTECTED_LEAD_META, true);
    return tr;
  }

  if (tr.doc.firstChild.type.name !== 'heading') {
    tr.insert(0, heading.create({ level: 2 }));
    tr.setMeta(PROTECTED_LEAD_META, true);
  }

  const first = tr.doc.firstChild;
  if (tr.doc.childCount < 2) {
    tr.insert(first.nodeSize, paragraph.create());
    tr.setMeta(PROTECTED_LEAD_META, true);
    return tr;
  }

  if (tr.doc.child(1).type.name !== 'paragraph') {
    tr.insert(first.nodeSize, paragraph.create());
    tr.setMeta(PROTECTED_LEAD_META, true);
  }

  return tr;
}

const ProtectedLead = Extension.create({
  name: 'protectedLead',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('protectedLead'),
        appendTransaction(transactions, _oldState, newState) {
          if (applyingRemote) return;
          if (!transactions.some((t) => t.docChanged)) return;
          if (transactions.some((t) => t.getMeta(PROTECTED_LEAD_META))) return;

          if (!docNeedsLeadFix(newState.doc)) return;

          const tr = fixLeadBlocks(newState.tr, newState.schema);
          return tr.docChanged ? tr : null;
        },
        props: {
          handleKeyDown(view, event) {
            if (!['Backspace', 'Delete'].includes(event.key)) return false;

            const { doc, selection } = view.state;
            const { from, to } = selection;
            const first = doc.firstChild;
            if (!first || first.type.name !== 'heading') return false;
            const second = doc.childCount > 1 ? doc.child(1) : null;
            if (!second || second.type.name !== 'paragraph') return false;

            const titleContentStart = 1;
            const titleContentEnd = titleContentStart + first.content.size;
            const leadContentStart = first.nodeSize + 1;
            const leadContentEnd = leadContentStart + second.content.size;

            if (event.key === 'Backspace') {
              if (from === to && from === leadContentStart) {
                event.preventDefault();
                return true;
              }
              if (from === to && from === titleContentStart && first.content.size === 0) {
                event.preventDefault();
                return true;
              }
            }

            if (event.key === 'Delete') {
              if (from === to && from === titleContentEnd && first.content.size === 0) {
                event.preventDefault();
                return true;
              }
              if (from === to && from === leadContentEnd && second.content.size === 0) {
                event.preventDefault();
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});

function getEditorContentJson(ed = editor) {
  if (!ed) return '';
  return JSON.stringify(ed.getJSON());
}

function restoreEditorSelection(ed, selection) {
  if (!ed || !selection) {
    ed?.view.focus();
    return;
  }
  queueMicrotask(() => {
    if (ed.isDestroyed) return;
    const max = ed.state.doc.content.size;
    const from = Math.min(Math.max(0, selection.from), max);
    const to = Math.min(Math.max(0, selection.to), max);
    try {
      if (from === to) {
        ed.chain().focus().setTextSelection(from).run();
      } else {
        ed.chain().focus().setTextSelection({ from, to }).run();
      }
    } catch (err) {
      console.warn('restore selection failed', err);
      ed.view.focus();
    }
  });
}

function scheduleSave() {
  if (!editor || !currentUid || !courseId || applyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(runPendingSave, 700);
}

async function runPendingSave() {
  if (!editor || !currentUid || !courseId || applyingRemote) return;

  if (saveInFlight) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(runPendingSave, 200);
    return;
  }

  persistCurrentPage();
  const bookJson = getBookStateJson();
  if (!bookJson || bookJson === lastSavedBookJson) return;

  setSyncStatus('saving', 'Guardando…');
  pendingSaveBookJson = bookJson;
  pendingSaveJson = getEditorContentJson();
  saveInFlight = true;
  try {
    await saveBook(currentUid, courseId, getBookPayload());
    persistCurrentPage();
    lastSavedBookJson = getBookStateJson();
    lastSavedJson = getEditorContentJson();
    lastLocalSaveAt = Date.now();
    pendingSaveBookJson = '';
    pendingSaveJson = '';
    setSyncStatus('saved', 'Guardado');
  } catch (err) {
    console.error(err);
    pendingSaveBookJson = '';
    pendingSaveJson = '';
    setSyncStatus('error', 'Error al guardar');
  } finally {
    saveInFlight = false;
    persistCurrentPage();
    if (getBookStateJson() !== lastSavedBookJson) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(runPendingSave, 300);
    }
  }
}

function parseRemoteBookData(data) {
  if (!data?.pages?.length) {
    return normalizeBookData(data);
  }
  const pages = data.pages.map((p, i) => ({
    id: p.id || crypto.randomUUID(),
    title: p.title || `Página ${i + 1}`,
    content: ensureLeadBlocks(p.content),
  }));
  const activePageId = pages.some((p) => p.id === data.activePageId)
    ? data.activePageId
    : pages[0].id;
  return { pages, activePageId };
}

function getRemoteBookJson(data) {
  const { pages, activePageId } = parseRemoteBookData(data);
  return JSON.stringify({ pages, activePageId });
}

function applyRemoteBook(data) {
  if (!editor || applyingRemote) return;

  const remoteBookJson = getRemoteBookJson(data);
  const remoteAt = getRemoteUpdatedAtMs(data);
  const localBookJson = getLocalBookJson();
  const currentPageJson = getEditorContentJson();

  // Nunca pisar el editor mientras hay cambios locales o un guardado en curso.
  if (saveInFlight || currentPageJson !== lastSavedJson) {
    return;
  }

  // Eco confirmado: el remoto coincide con lo último guardado.
  if (remoteBookJson === lastSavedBookJson) {
    if (remoteAt) lastLocalSaveAt = Math.max(lastLocalSaveAt, remoteAt);
    return;
  }

  // Ya en sync total.
  if (remoteBookJson === localBookJson) {
    lastSavedBookJson = remoteBookJson;
    if (remoteAt) lastLocalSaveAt = Math.max(lastLocalSaveAt, remoteAt);
    return;
  }

  // Remoto desactualizado: subir lo local (nunca setContent en vivo).
  scheduleSave();
}


function mountHeadlessToolbar() {
  /* Ya no hace nada, el toolbar está en el HTML */
}

function syncHeadlessToolbar(ed) {
  if (!ed) return;

  document.querySelectorAll('.headless-toolbar--combined [data-cmd]').forEach((btn) => {
    const cmd = btn.dataset.cmd;
    const hasSelection = !ed.state.selection.empty;
    const currentTextAlign = hasSelection
      ? ed.isActive({ textAlign: 'justify' })
        ? 'justify'
        : ed.isActive({ textAlign: 'center' })
          ? 'center'
          : ed.isActive({ textAlign: 'left' })
            ? 'left'
            : ''
      : '';

    if (isClearFormatCmd(cmd)) { btn.classList.remove('is-active'); return; }
    if (cmd === 'alignLeft')    { btn.classList.toggle('is-active', currentTextAlign === 'left');    btn.disabled = false; return; }
    if (cmd === 'alignCenter')  { btn.classList.toggle('is-active', currentTextAlign === 'center');  btn.disabled = false; return; }
    if (cmd === 'alignJustify') { btn.classList.toggle('is-active', currentTextAlign === 'justify'); btn.disabled = false; return; }
    if (cmd === 'underline')    { btn.classList.toggle('is-active', hasSelection && ed.isActive('underline')); btn.disabled = !ed.can().toggleUnderline(); return; }
    if (cmd === 'image')        { btn.disabled = false; return; }

    btn.classList.toggle('is-active', isHeadlessCommandActive(ed, cmd));
    btn.disabled = !canRunHeadlessCommand(ed, cmd);
  });

  // Sincroniza el select de títulos
  const headingSelect = document.getElementById('tb-heading');
  if (headingSelect) {
    const active = [1,2,3,4,5,6].find(l => ed.isActive('heading', { level: l }));
    headingSelect.value = active ? String(active) : '';
  }
}

function initHeadlessToolbar(ed) {
  mountHeadlessToolbar();
  lockAllBroomButtons(els.toolbar);

  // Prevent toolbar buttons from stealing editor focus/selection.
  // Selects must keep their default behavior so their dropdowns can open.
  els.toolbar?.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
  });

  els.toolbar?.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      if (cmd === 'image') {
        els.imageInput?.click();
        return;
      }
      runToolbarAction(ed, () => {
        if (cmd === 'underline') {
          ed.chain().focus().toggleUnderline().run();
        } else {
          runHeadlessCommand(ed, cmd);
        }
      });
      syncHeadlessToolbar(ed);
    });
  });

  document.getElementById('tb-heading')?.addEventListener('change', (e) => {
    const level = parseInt(e.target.value, 10);
    runToolbarAction(ed, () => {
      if (level) {
        ed.chain().focus().toggleHeading({ level }).run();
      } else {
        const first = ed.state.doc.firstChild;
        const inTitle = first?.type.name === 'heading' && ed.state.selection.from <= first.nodeSize;
        if (inTitle) {
          e.target.value = String(first.attrs.level || 2);
          return;
        }
        ed.chain().focus().setParagraph().run();
      }
    });
    syncHeadlessToolbar(ed);
  });

  document.getElementById('tb-font')?.addEventListener('change', (e) => {
    const font = e.target.value;
    runToolbarAction(ed, () => {
      if (font) ed.chain().focus().setFontFamily(font).run();
      else ed.chain().focus().unsetFontFamily().run();
    });
  });

  els.imageInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSyncStatus('saving', 'Subiendo imagen…');
    try {
      const url = await uploadToCloudinary(file);
      ed.chain().focus().setImage({ src: url }).run();
      scheduleSave();
      syncHeadlessToolbar(ed);
    } catch (err) {
      alert(err.message || 'No se pudo subir la imagen');
      setSyncStatus('error', 'Error imagen');
    }
  });
}
function getLeadParagraphPos(doc) {
  if (doc.childCount < 2) return null;
  if (doc.child(1).type.name !== 'paragraph') return null;
  return doc.child(0).nodeSize;
}

function docHasBodyContent(doc) {
  let index = 0;
  let hasBody = false;
  doc.forEach((node) => {
    if (hasBody) return;
    if (index === 0 && node.type.name === 'heading') {
      index += 1;
      return;
    }
    if (index === 1 && node.type.name === 'paragraph') {
      if (node.content.size > 0) hasBody = true;
      index += 1;
      return;
    }
    if (node.type.name === 'paragraph') {
      if (node.content.size > 0) hasBody = true;
      return;
    }
    hasBody = true;
  });
  return hasBody;
}

function shouldShowStartWritingPlaceholder(doc, paragraphPos) {
  if (getLeadParagraphPos(doc) !== paragraphPos) return false;
  return !docHasBodyContent(doc);
}

function createEditor(initialContent) {
  editor = new Editor({
    element: els.editorMount,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: null,
        HTMLAttributes: { class: 'code-block-cascadia' },
      }),
      Heading.configure({
        levels: [1, 2, 3, 4, 5, 6],
      }),
      Underline,
      TextStyle,
      FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: ({ node, pos, editor }) => {
          if (node.type.name === 'heading') return 'Título';
          if (node.type.name === 'paragraph') {
            if (node.content.size === 0 && shouldShowStartWritingPlaceholder(editor.state.doc, pos)) {
              return 'Empieza a escribir...';
            }
            return '';
          }
          return '';
        },
        showOnlyCurrent: false,
        showOnlyWhenEditable: true,
        emptyNodeClass: 'is-empty',
      }),
      SlashCommand,
      ProtectedLead,
      CodeBlockLanguageLabels,
      ClickToWrite,
    ],
    content: ensureLeadBlocks(initialContent),
    editorProps: {
      attributes: {
        class: 'tiptap headless-prose',
        spellcheck: 'true',
      },
      handleDrop(_view, event) {
        const file = event.dataTransfer?.files?.[0];
        if (file?.type.startsWith('image/')) {
          event.preventDefault();
          uploadAndInsertImage(file);
          return true;
        }
        return false;
      },
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              uploadAndInsertImage(file);
              return true;
            }
          }
        }
        return false;
      },
    },
    onCreate: ({ editor: ed }) => {
      syncHeadlessToolbar(ed);
      refreshCodeBlockHighlight(ed);
    },
    onUpdate: ({ editor: ed }) => {
      syncHeadlessToolbar(ed);
      scheduleSave();
      if (!applyingRemote) scheduleCodeBlockLanguageDetection(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => syncHeadlessToolbar(ed),
  });

  editorRef.current = editor;
  initHeadlessToolbar(editor);
  syncHeadlessToolbar(editor);
}
async function uploadAndInsertImage(file) {
  if (!editor) return;
  setSyncStatus('saving', 'Subiendo imagen…');
  try {
    const url = await uploadToCloudinary(file);
    editor.chain().focus().setImage({ src: url }).run();
    scheduleSave();
    syncHeadlessToolbar(editor);
  } catch (err) {
    alert(err.message || 'No se pudo subir la imagen');
    setSyncStatus('error', 'Error imagen');
  }
}

function showError(message) {
  if (els.loading) {
    els.loading.classList.remove('hidden');
    els.loading.innerHTML = `<p>${message}</p>`;
  }
  els.app?.classList.add('hidden');
}

function showApp() {
  els.loading?.classList.add('hidden');
  els.app?.classList.remove('hidden');
  if (isCoursesHub) {
    updateCourseHeader();
  } else {
    if (els.title) els.title.textContent = courseTitle;
    if (els.emoji) els.emoji.textContent = courseEmoji;
  }
}

async function bootCoursesHub(uid) {
  try {
    hubDashboard = await fetchUserDashboard(uid);
    hubCourses = (hubDashboard?.courses || []).filter((c) => !c.hidden);
  } catch (err) {
    console.error(err);
    showError('No se pudieron cargar los cursos.');
    return;
  }

  if (!hubCourses.length) {
    showError('No hay cursos. Crea uno en el dashboard.');
    return;
  }

  courseId = courseId || String(hubCourses[0].id);
  if (!hubCourses.some((c) => String(c.id) === String(courseId))) {
    courseId = String(hubCourses[0].id);
  }

  showApp();
  renderCoursesList();

  let initial = null;
  try {
    const data = await fetchBook(uid, courseId);
    bookState = normalizeBookData(data);
    initial = getActivePage()?.content || null;
    lastLocalSaveAt = getRemoteUpdatedAtMs(data) || Date.now();
    lastSavedBookJson = getBookStateJson();
  } catch (err) {
    console.error(err);
    setSyncStatus('error', 'Error al cargar');
    bookState = normalizeBookData(null);
  }

  createEditor(initial);
  persistCurrentPage();
  lastSavedJson = getEditorContentJson();
  lastSavedBookJson = getBookStateJson();
  initPagesSidebar();
  updateCourseHeader();

  if (initialPageId && bookState.pages.some((p) => p.id === initialPageId)) {
    switchPage(initialPageId);
  }

  unsubBook = subscribeBook(
    uid,
    courseId,
    (data) => {
      if (data) applyRemoteBook(data);
    },
    (err) => {
      console.error(err);
      setSyncStatus('error', 'Sync desconectada');
    }
  );

  setSyncStatus('saved', 'Listo');
}

async function bootBook(uid) {
  if (isCoursesHub) {
    await bootCoursesHub(uid);
    return;
  }

  if (!courseId) {
    els.loading.innerHTML = '<p>Falta el parámetro courseId en la URL.</p>';
    return;
  }

  showApp();
  let initial = null;
  try {
    const data = await fetchBook(uid, courseId);
    bookState = normalizeBookData(data);
    initial = getActivePage()?.content || null;
    lastLocalSaveAt = getRemoteUpdatedAtMs(data) || Date.now();
    lastSavedBookJson = getBookStateJson();
  } catch (err) {
    console.error(err);
    setSyncStatus('error', 'Error al cargar');
    bookState = normalizeBookData(null);
  }

  createEditor(initial);
  persistCurrentPage();
  lastSavedJson = getEditorContentJson();
  lastSavedBookJson = getBookStateJson();
  initPagesSidebar();

  if (initialPageId && bookState.pages.some((p) => p.id === initialPageId)) {
    switchPage(initialPageId);
  }

  unsubBook = subscribeBook(
    uid,
    courseId,
    (data) => {
      if (data) applyRemoteBook(data);
    },
    (err) => {
      console.error(err);
      setSyncStatus('error', 'Sync desconectada');
    }
  );

  setSyncStatus('saved', 'Listo');
}

function initBook() {
  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        currentUid = user.uid;
        await bootBook(user.uid);
      } else {
        currentUid = null;
        if (unsubBook) unsubBook();
        editor?.destroy();
        editor = null;
        editorRef.current = null;
        showError('No se pudo abrir el cuaderno. Por favor registrate en el dashboard.');
      }
    } catch (err) {
      console.error(err);
      showError('Error al cargar: ' + (err.message || 'desconocido'));
    }
  });
}



setSyncStatus('idle', 'Listo');

if (isCoursesHub) {
  initBook();
} else if (!courseId) {
  els.loading.innerHTML =
    '<p>Enlace inválido: falta <code>courseId</code>. Abre el cuaderno desde una tarjeta de curso.</p>';
} else {
  initBook();
}