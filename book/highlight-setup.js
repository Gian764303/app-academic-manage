import { createLowlight, common } from 'https://esm.sh/lowlight@3';
import hljs from 'https://esm.sh/highlight.js@11.11.1';
import { Plugin, PluginKey } from 'https://esm.sh/@tiptap/pm@2.11.5/state';
import { Decoration, DecorationSet } from 'https://esm.sh/@tiptap/pm@2.11.5/view';

export const lowlight = createLowlight(common);

const codeBlockLanguageKey = new PluginKey('codeBlockLanguageLabels');

const DETECT_SUBSET = [
  'python', 'javascript', 'typescript', 'java', 'css', 'html', 'xml', 'json',
  'bash', 'shell', 'sql', 'php', 'ruby', 'go', 'rust', 'csharp', 'cpp', 'c',
  'kotlin', 'swift', 'yaml', 'markdown',
];

const LANG_LABELS = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  csharp: 'C#',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  json: 'JSON',
  bash: 'Bash',
  shell: 'Shell',
  sql: 'SQL',
  php: 'PHP',
  ruby: 'Ruby',
  go: 'Go',
  rust: 'Rust',
  kotlin: 'Kotlin',
  swift: 'Swift',
  yaml: 'YAML',
  markdown: 'Markdown',
  plaintext: 'Texto',
};

export function formatLanguageLabel(lang) {
  if (!lang) return 'Texto';
  return LANG_LABELS[lang] || lang.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function detectLanguage(text) {
  if (!text || !text.trim()) return null;
  try {
    const { language } = hljs.highlightAuto(text, DETECT_SUBSET);
    return language || null;
  } catch {
    return null;
  }
}

function codeBlockLanguagesChanged(docA, docB) {
  const langsA = [];
  const langsB = [];
  docA.descendants((n) => {
    if (n.type.name === 'codeBlock') langsA.push(n.attrs.language || '');
  });
  docB.descendants((n) => {
    if (n.type.name === 'codeBlock') langsB.push(n.attrs.language || '');
  });
  return langsA.join('|') !== langsB.join('|');
}

export function buildCodeBlockLanguageDecorations(doc) {
  const decorations = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;

    const label = formatLanguageLabel(node.attrs.language || '');

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: 'code-block-labeled',
        'data-lang-label': label,
      })
    );

    decorations.push(
      Decoration.widget(
        pos,
        () => createCopyButtonElement(),
        { side: -1, key: `code-copy-${pos}` }
      )
    );
  });

  return DecorationSet.create(doc, decorations);
}

export function createCodeBlockLanguagePlugin() {
  return new Plugin({
    key: codeBlockLanguageKey,
    state: {
      init(_, { doc }) {
        return buildCodeBlockLanguageDecorations(doc);
      },
      apply(tr, set, oldState, newState) {
        if (!tr.docChanged && !codeBlockLanguagesChanged(oldState.doc, newState.doc)) {
          return set.map(tr.mapping, tr.doc);
        }
        return buildCodeBlockLanguageDecorations(newState.doc);
      },
    },
    props: {
      decorations(state) {
        return codeBlockLanguageKey.getState(state);
      },
    },
  });
}

const COPY_BTN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function showCopyFeedback(btn) {
  btn.classList.add('is-copied');
  btn.setAttribute('aria-label', 'Copiado');
  const label = btn.querySelector('.code-block-copy-label');
  const prev = label?.textContent;
  if (label) label.textContent = 'Copiado';
  clearTimeout(btn._copyFeedbackTimer);
  btn._copyFeedbackTimer = setTimeout(() => {
    btn.classList.remove('is-copied');
    btn.setAttribute('aria-label', 'Copiar código');
    if (label && prev) label.textContent = prev;
  }, 1500);
}

async function copyCodeBlockText(text, btn) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showCopyFeedback(btn);
    return;
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showCopyFeedback(btn);
  } catch {
    /* ignore */
  }
}

function createCopyButtonElement() {
  const slot = document.createElement('div');
  slot.className = 'code-block-copy-slot';
  slot.contentEditable = 'false';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'code-block-copy-btn';
  btn.setAttribute('aria-label', 'Copiar código');
  btn.innerHTML = `${COPY_BTN_SVG}<span class="code-block-copy-label">Copiar</span>`;

  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pre = slot.nextElementSibling;
    if (!pre || pre.tagName !== 'PRE') return;
    const code = pre.querySelector('code');
    const text = code ? code.textContent : pre.textContent;
    copyCodeBlockText(text, btn);
  });

  slot.appendChild(btn);
  return slot;
}

let detectTimer = null;

export function flushCodeBlockLanguageDetection(ed) {
  if (!ed || ed.isDestroyed) return;
  clearTimeout(detectTimer);
  detectTimer = null;
  detectCodeBlockLanguages(ed);
}

export function scheduleCodeBlockLanguageDetection(ed) {
  if (!ed || ed.isDestroyed) return;
  clearTimeout(detectTimer);
  detectTimer = setTimeout(() => detectCodeBlockLanguages(ed), 450);
}

export function detectCodeBlockLanguages(ed) {
  if (!ed || ed.isDestroyed) return;

  const { state } = ed;
  const codeBlock = state.schema.nodes.codeBlock;
  if (!codeBlock) return;

  let tr = null;
  state.doc.descendants((node, pos) => {
    if (node.type !== codeBlock) return;
    const text = node.textContent;
    if (!text.trim()) {
      if (node.attrs.language) {
        if (!tr) tr = state.tr;
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: null });
      }
      return;
    }
    const detected = detectLanguage(text);
    if (detected !== node.attrs.language) {
      if (!tr) tr = state.tr;
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: detected });
    }
  });

  if (tr?.docChanged) {
    tr.setMeta('skipTrailingParagraph', true);
    try {
      ed.view.dispatch(tr);
    } catch (err) {
      console.warn('code block language detect failed', err);
    }
  }
}

export { hljs };
