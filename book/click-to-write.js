import { Extension } from 'https://esm.sh/@tiptap/core@2.11.5';
import { Plugin, PluginKey, TextSelection } from 'https://esm.sh/@tiptap/pm@2.11.5/state';

let skipTrailingInsert = false;

export function setSkipTrailingInsert(value) {
  skipTrailingInsert = value;
}

function getTopLevelBlockElements(editorEl) {
  return Array.from(editorEl.children).filter(
    (el) => el.nodeType === 1 && !el.classList.contains('ProseMirror-widget')
  );
}

function getPosAfterBlockIndex(doc, blockIndex) {
  let pos = 0;
  doc.forEach((node, offset, index) => {
    if (index === blockIndex) pos = offset + node.nodeSize;
  });
  return pos;
}

function focusParagraphAt(view, pos) {
  const { doc, tr } = view.state;
  view.dispatch(tr.setSelection(TextSelection.create(doc, pos)));
  view.focus();
}

function insertEmptyParagraphAt(view, pos) {
  const { tr, schema } = view.state;
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return;
  const nextTr = tr.insert(pos, paragraph.create());
  nextTr.setSelection(TextSelection.create(nextTr.doc, pos + 1));
  view.dispatch(nextTr);
  view.focus();
}

function focusTrailingParagraph(view) {
  const { doc } = view.state;
  const last = doc.lastChild;

  if (last?.type.name === 'paragraph') {
    if (last.content.size === 0) {
      focusParagraphAt(view, doc.content.size - 1);
      return;
    }
    insertEmptyParagraphAt(view, doc.content.size);
    return;
  }

  insertEmptyParagraphAt(view, doc.content.size);
}

function insertParagraphAfterBlockIndex(view, blockIndex) {
  const { doc } = view.state;
  if (blockIndex === 0 && doc.childCount > 1 && doc.child(1).type.name === 'paragraph') {
    focusParagraphAt(view, doc.child(0).nodeSize + 1);
    return;
  }
  const pos = getPosAfterBlockIndex(doc, blockIndex);
  insertEmptyParagraphAt(view, pos);
}

function handleClickToWrite(view, event) {
  if (!view.editable || event.button !== 0) return false;

  const editorEl = view.dom;
  if (!editorEl.contains(event.target)) return false;

  const blockEls = getTopLevelBlockElements(editorEl);
  if (!blockEls.length) return false;

  const clickY = event.clientY;
  const lastEl = blockEls[blockEls.length - 1];
  const lastRect = lastEl.getBoundingClientRect();

  if (clickY > lastRect.bottom + 2) {
    event.preventDefault();
    focusTrailingParagraph(view);
    return true;
  }

  for (let i = 0; i < blockEls.length - 1; i++) {
    const gapTop = blockEls[i].getBoundingClientRect().bottom;
    const gapBottom = blockEls[i + 1].getBoundingClientRect().top;
    if (clickY > gapTop + 2 && clickY < gapBottom - 2) {
      event.preventDefault();
      insertParagraphAfterBlockIndex(view, i);
      return true;
    }
  }

  return false;
}

export const ClickToWrite = Extension.create({
  name: 'clickToWrite',

  addProseMirrorPlugins() {
    const trailingKey = new PluginKey('trailingParagraph');

    return [
      new Plugin({
        key: trailingKey,
        appendTransaction(transactions, _oldState, state) {
          if (skipTrailingInsert) return;
          if (transactions.some((tr) => tr.getMeta('skipTrailingParagraph'))) return;
          const last = state.doc.lastChild;
          if (!last || last.type.name === 'paragraph') return;
          const { tr, schema } = state;
          const paragraph = schema.nodes.paragraph;
          if (!paragraph) return;
          return tr.insert(state.doc.content.size, paragraph.create());
        },
      }),
      new Plugin({
        key: new PluginKey('clickToWrite'),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => handleClickToWrite(view, event),
          },
        },
      }),
    ];
  },
});
