export const HEADLESS_BUTTONS = [
  { cmd: 'bold', label: 'bold' },
  { cmd: 'italic', label: 'italic' },
  { cmd: 'strike', label: 'strike' },
  { cmd: 'code', label: 'code' },
  { type: 'divider' },
  { cmd: 'clearMarks', label: 'clear marks' },
  { cmd: 'clearNodes', label: 'clear nodes' },
  { cmd: 'undo', label: 'undo' },
  { cmd: 'redo', label: 'redo' },
  { type: 'divider' },
  { cmd: 'paragraph', label: 'paragraph' },
  { cmd: 'h1', label: 'h1' },
  { cmd: 'h2', label: 'h2' },
  { cmd: 'h3', label: 'h3' },
  { cmd: 'h4', label: 'h4' },
  { cmd: 'h5', label: 'h5' },
  { cmd: 'h6', label: 'h6' },
  { type: 'divider' },
  { cmd: 'bulletList', label: 'bullet list' },
  { cmd: 'orderedList', label: 'ordered list' },
  { type: 'divider' },
  { cmd: 'codeBlock', label: 'code block' },
  { cmd: 'blockquote', label: 'blockquote' },
  { cmd: 'horizontalRule', label: 'horizontal rule' },
  { cmd: 'hardBreak', label: 'hard break' },
];

export function isClearFormatCmd(cmd) {
  return cmd === 'clearFormat' || cmd === 'paragraph';
}

/** La escoba es una acción libre: nunca puede quedar disabled. */
export function lockBroomButton(btn) {
  if (!btn || btn.dataset.broomLocked) return;
  btn.dataset.broomLocked = '1';
  Object.defineProperty(btn, 'disabled', {
    get() { return false; },
    set() { /* ignorar */ },
    configurable: true,
  });
  btn.removeAttribute('disabled');
}

export function lockAllBroomButtons(root = document) {
  root.querySelectorAll('[data-cmd="clearFormat"], [data-cmd="paragraph"]').forEach(lockBroomButton);
}

/** Restaura foco y selección visual tras un clic en la toolbar. */
export function runToolbarAction(ed, fn) {
  const { from, to, empty } = ed.state.selection;
  fn();
  queueMicrotask(() => {
    ed.view.focus();
    if (!empty) {
      ed.commands.setTextSelection({ from, to });
    }
  });
}

export function runHeadlessCommand(ed, cmd) {
  const chain = ed.chain().focus();
  switch (cmd) {
    case 'bold':           return chain.toggleBold().run();
    case 'italic':         return chain.toggleItalic().run();
    case 'strike':         return chain.toggleStrike().run();
    case 'code':           return chain.toggleCode().run();
    case 'underline':      return chain.toggleUnderline().run();
    case 'clearMarks':     return chain.unsetAllMarks().run();
    case 'clearNodes':     return chain.clearNodes().run();
    case 'undo':           return chain.undo().run();
    case 'redo':           return chain.redo().run();
    case 'clearFormat':
    case 'paragraph': {
      const { from, to, empty } = ed.state.selection;
      if (!empty) {
        ed.chain().focus().unsetAllMarks().run();
        return true;
      }
      const { $from } = ed.state.selection;
      ed.chain().focus().setTextSelection({
        from: $from.start($from.depth),
        to: $from.end($from.depth),
      }).run();
      ed.chain().focus().unsetAllMarks().run();
      ed.chain().focus().clearNodes().run();
      ed.chain().focus().unsetFontFamily().run();
      ed.chain().focus().setTextAlign('left').run();
      ed.chain().focus().setTextSelection(from).run();
      return true;
    }
    case 'h1':             return chain.toggleHeading({ level: 1 }).run();
    case 'h2':             return chain.toggleHeading({ level: 2 }).run();
    case 'h3':             return chain.toggleHeading({ level: 3 }).run();
    case 'h4':             return chain.toggleHeading({ level: 4 }).run();
    case 'h5':             return chain.toggleHeading({ level: 5 }).run();
    case 'h6':             return chain.toggleHeading({ level: 6 }).run();
    case 'bulletList':     return chain.toggleBulletList().run();
    case 'orderedList':    return chain.toggleOrderedList().run();
    case 'codeBlock':      return chain.toggleCodeBlock().run();
    case 'blockquote':     return chain.toggleBlockquote().run();
    case 'horizontalRule': return chain.setHorizontalRule().run();
    case 'hardBreak':      return chain.setHardBreak().run();
    case 'alignLeft':      return chain.setTextAlign('left').run();
    case 'alignCenter':    return chain.setTextAlign('center').run();
    case 'alignJustify':   return chain.setTextAlign('justify').run();
    case 'insertTable':    return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    case 'addRowAfter':    return chain.addRowAfter().run();
    case 'addColumnAfter': return chain.addColumnAfter().run();
    case 'deleteTable':    return chain.deleteTable().run();
    default:               return false;
  }
}

export function canRunHeadlessCommand(ed, cmd) {
  const can = ed.can();
  switch (cmd) {
    case 'bold':
      return can.toggleBold();
    case 'italic':
      return can.toggleItalic();
    case 'strike':
      return can.toggleStrike();
    case 'code':
      return can.toggleCode();
    case 'underline':
      return can.toggleUnderline();
    case 'clearMarks':
      return can.unsetAllMarks();
    case 'clearNodes':
      return can.clearNodes();
    case 'undo':
      return can.undo();
    case 'redo':
      return can.redo();
    case 'clearFormat':
    case 'paragraph':
      return true;
    case 'h1':
      return can.toggleHeading({ level: 1 });
    case 'h2':
      return can.toggleHeading({ level: 2 });
    case 'h3':
      return can.toggleHeading({ level: 3 });
    case 'h4':
      return can.toggleHeading({ level: 4 });
    case 'h5':
      return can.toggleHeading({ level: 5 });
    case 'h6':
      return can.toggleHeading({ level: 6 });
    case 'bulletList':
      return can.toggleBulletList();
    case 'orderedList':
      return can.toggleOrderedList();
    case 'codeBlock':
      return can.toggleCodeBlock();
    case 'blockquote':
      return can.toggleBlockquote();
    case 'horizontalRule':
      return can.setHorizontalRule();
    case 'hardBreak':
      return can.setHardBreak();
    case 'alignLeft':
      return can.setTextAlign('left');
    case 'alignCenter':
      return can.setTextAlign('center');
    case 'alignJustify':
      return can.setTextAlign('justify');
    case 'insertTable':
      return can.insertTable();
    case 'addRowAfter':
      return can.addRowAfter();
    case 'addColumnAfter':
      return can.addColumnAfter();
    case 'deleteTable':
      return can.deleteTable();
    default:
      return false;
  }
}

export function isHeadlessCommandActive(ed, cmd) {
  const hasSelection = !ed.state.selection.empty;
  switch (cmd) {
    case 'bold':
      return hasSelection && ed.isActive('bold');
    case 'italic':
      return hasSelection && ed.isActive('italic');
    case 'strike':
      return hasSelection && ed.isActive('strike');
    case 'code':
      return hasSelection && ed.isActive('code');
    case 'underline':
      return hasSelection && ed.isActive('underline');
    case 'clearFormat':
    case 'paragraph':
      return false;
    case 'h1':
      return ed.isActive('heading', { level: 1 });
    case 'h2':
      return ed.isActive('heading', { level: 2 });
    case 'h3':
      return ed.isActive('heading', { level: 3 });
    case 'h4':
      return ed.isActive('heading', { level: 4 });
    case 'h5':
      return ed.isActive('heading', { level: 5 });
    case 'h6':
      return ed.isActive('heading', { level: 6 });
    case 'bulletList':
      return ed.isActive('bulletList');
    case 'orderedList':
      return ed.isActive('orderedList');
    case 'codeBlock':
      return ed.isActive('codeBlock');
    case 'blockquote':
      return ed.isActive('blockquote');
    case 'insertTable':
      return ed.isActive('table');
    default:
      return false;
  }
}
