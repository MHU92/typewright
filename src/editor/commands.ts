// Editor-Befehle für Menüband, Menü und Tastenkürzel.

import { Extension, type Editor } from '@tiptap/core';
import type { Mark as PMMark } from '@tiptap/pm/model';
import { editCode } from './context';
import { t } from '../i18n';

export type Align = 'left' | 'center' | 'right' | 'justify';

export const ui: {
  openLink?: () => void;
  openFind?: (replace: boolean) => void;
} = {};

export function setAlign(editor: Editor, align: Align | null) {
  const { state } = editor;
  const tr = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: align === 'left' ? null : align });
      return false;
    }
    return true;
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

/** Linksbündig wird ausdrücklich geschrieben, wenn das Dokument Blocksatz vorgibt. */
export function setAlignWithDefault(editor: Editor, align: Align, justifyDefault: boolean) {
  if (align === 'left') return setAlign(editor, justifyDefault ? 'left' : null);
  if (align === 'justify') return setAlign(editor, justifyDefault ? null : 'justify');
  return setAlign(editor, align);
}

export function currentAlign(editor: Editor, justifyDefault: boolean): Align {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'paragraph' || n.type.name === 'heading') {
      const a = n.attrs.align as Align | null;
      return a ?? (justifyDefault ? 'justify' : 'left');
    }
  }
  return justifyDefault ? 'justify' : 'left';
}

export function setTextStyle(editor: Editor, patch: Record<string, string | null>) {
  const current = editor.getAttributes('textStyle');
  const next = { fill: null, size: null, font: null, weight: null, rest: null, ...current, ...patch };
  const empty = !next.fill && !next.size && !next.font && !next.weight && !next.rest;
  if (empty) editor.chain().focus().unsetMark('textStyle').run();
  else editor.chain().focus().setMark('textStyle', next).run();
}

export function setHighlight(editor: Editor, fill: string | null | undefined) {
  if (fill === undefined) editor.chain().focus().unsetMark('highlight').run();
  else editor.chain().focus().setMark('highlight', { fill }).run();
}

export function clearFormatting(editor: Editor) {
  editor.chain().focus().unsetAllMarks().run();
  setAlign(editor, null);
}

export function setBlockStyle(editor: Editor, style: string) {
  const c = editor.chain().focus();
  switch (style) {
    case 'paragraph':
      c.setParagraph().run();
      break;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
      c.setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 | 4 | 5 }).run();
      break;
    case 'quote':
      c.toggleBlockquote().run();
      break;
    case 'code':
      c.toggleCodeBlock().run();
      break;
  }
}

export function currentBlockStyle(editor: Editor): string {
  if (editor.isActive('codeBlock')) return 'code';
  if (editor.isActive('blockquote')) return 'quote';
  for (let l = 1; l <= 6; l++) if (editor.isActive('heading', { level: l })) return `h${l}`;
  return 'paragraph';
}

export function insertImage(editor: Editor, src: string) {
  editor.chain().focus().insertContent({ type: 'image', attrs: { src, width: '80%' } }).run();
}

export function insertFigure(editor: Editor, src: string) {
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'figure',
      content: [
        { type: 'image', attrs: { src, width: '80%', code: true } },
        { type: 'figcaption', content: [{ type: 'text', text: t('Caption') }] },
      ],
    })
    .run();
}

export function insertFootnote(editor: Editor) {
  const { from } = editor.state.selection;
  const text = t('Footnote text');
  editor
    .chain()
    .focus()
    .insertContent({ type: 'text', text, marks: [{ type: 'callMark', attrs: { callee: 'footnote', args: null } }] })
    .setTextSelection({ from, to: from + text.length })
    .run();
}

export function insertMath(editor: Editor, display: boolean) {
  const src = display ? '$ a^2 + b^2 = c^2 $' : '$x^2$';
  const type = display ? 'mathBlock' : 'mathInline';
  editor.chain().focus().insertContent({ type, attrs: { src } }).run();
  const pos = editor.state.selection.from - (display ? 1 : 1);
  editCode({
    title: t('Equation'),
    hint: t('Typst math between $ signs. Examples: a^2, sqrt(x), sum_(i=1)^n i, alpha, x_1.'),
    code: src,
    language: 'math',
    onSave: (code) => {
      const node = editor.state.doc.nodeAt(pos);
      if (node && node.type.name === type) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: code }));
      else {
        // Position verschoben: letzte Formel mit dem Platzhalter suchen
        editor.state.doc.descendants((n, p) => {
          if (n.type.name === type && n.attrs.src === src) {
            editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, src: code }));
            return false;
          }
          return true;
        });
      }
    },
  });
}

export function insertTypst(editor: Editor) {
  const placeholder = `#box(stroke: 0.5pt, inset: 6pt)[${t('Typst code')}]`;
  editor.chain().focus().insertContent({ type: 'typstBlock', attrs: { src: placeholder, kind: 'expr' } }).run();
  editCode({
    title: t('Insert Typst code'),
    hint: t('Any Typst code. The editor shows it exactly as it appears in the PDF.'),
    code: placeholder,
    onSave: (code) => {
      editor.state.doc.descendants((n, p) => {
        if (n.type.name === 'typstBlock' && n.attrs.src === placeholder) {
          const kind = /^#(let|set|show|import)\b/.test(code.trim()) ? 'code' : 'expr';
          editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, src: code, kind }));
          return false;
        }
        return true;
      });
    },
  });
}

export function insertRef(editor: Editor, label: string) {
  editor.chain().focus().insertContent({ type: 'typstInline', attrs: { src: `@${label}`, kind: 'ref' } }).insertContent(' ').run();
}

/** Alle Sprungmarken im Dokument (für Querverweise). */
export function collectLabels(editor: Editor): { label: string; text: string; type: string }[] {
  const out: { label: string; text: string; type: string }[] = [];
  editor.state.doc.descendants((n) => {
    if (n.attrs?.label) out.push({ label: String(n.attrs.label), text: n.textContent.slice(0, 60), type: n.type.name });
    if (n.type.name === 'typstInline' && n.attrs.kind === 'label') out.push({ label: String(n.attrs.src).slice(1, -1), text: '', type: 'label' });
    return true;
  });
  return out;
}

// ------------------------------------------------------------------ Format übertragen

let painter: readonly PMMark[] | null = null;
let painterListener: ((on: boolean) => void) | null = null;

export function onPainterChange(fn: (on: boolean) => void) {
  painterListener = fn;
}

export function startFormatPainter(editor: Editor) {
  const { $from, empty } = editor.state.selection;
  painter = empty ? $from.marks() : (editor.state.doc.resolve(editor.state.selection.from + 1).marks() ?? $from.marks());
  painterListener?.(true);
}

export function applyFormatPainter(editor: Editor): boolean {
  if (!painter) return false;
  const { from, to, empty } = editor.state.selection;
  if (empty) return false;
  const tr = editor.state.tr;
  for (const mt of Object.values(editor.schema.marks)) tr.removeMark(from, to, mt);
  for (const m of painter) tr.addMark(from, to, m);
  editor.view.dispatch(tr);
  painter = null;
  painterListener?.(false);
  return true;
}

// ------------------------------------------------------------------ Tastenkürzel

export function shortcutsExtension(opts: { justifyDefault: () => boolean }) {
  return Extension.create({
    name: 'twShortcuts',
    addKeyboardShortcuts() {
      const ed = () => this.editor;
      return {
        'Mod-Alt-0': () => ed().commands.setParagraph(),
        'Mod-Shift-x': () => ed().commands.toggleStrike(),
        'Mod-\\': () => (clearFormatting(ed()), true),
        'Mod-Shift-l': () => (setAlignWithDefault(ed(), 'left', opts.justifyDefault()), true),
        'Mod-Shift-e': () => (setAlignWithDefault(ed(), 'center', opts.justifyDefault()), true),
        'Mod-Shift-r': () => (setAlignWithDefault(ed(), 'right', opts.justifyDefault()), true),
        'Mod-Shift-j': () => (setAlignWithDefault(ed(), 'justify', opts.justifyDefault()), true),
        'Mod-Enter': () => ed().chain().insertContent({ type: 'pageBreak' }).run(),
        'Mod-k': () => (ui.openLink?.(), true),
        'Mod-Alt-f': () => (insertFootnote(ed()), true),
        'Mod-Ctrl-m': () => (insertMath(ed(), false), true),
        'Shift-Mod-h': () => (ui.openFind?.(true), true),
      };
    },
  });
}
