// Dokumentmodell des Editors. Rein (ohne React), damit Parser- und Serializer-Tests
// das Schema auch in Node aufbauen können. Node-Views hängt der Renderer per
// `withNodeViews` an.

import { Extension, Mark, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import HardBreak from '@tiptap/extension-hard-break';
import Link from '@tiptap/extension-link';
import Blockquote from '@tiptap/extension-blockquote';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { BulletList, OrderedList, ListItem, ListKeymap } from '@tiptap/extension-list';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Dropcursor, Gapcursor, UndoRedo, TrailingNode } from '@tiptap/extensions';
import { typstColorToCss } from '../typst/values';

/** Block-Knoten, die einen `sep`-Wert (Leerraum davor im Quelltext) tragen. */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'blockquote',
  'horizontalRule',
  'table',
  'image',
  'figure',
  'mathBlock',
  'typstBlock',
  'callBlock',
  'pageBreak',
  'toc',
];

const SepAttribute = Extension.create({
  name: 'typstSep',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          sep: { default: null, rendered: false, keepOnSplit: false },
        },
      },
      {
        types: ['paragraph', 'heading'],
        attributes: {
          align: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.textAlign || null,
            renderHTML: (attrs) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
          },
        },
      },
      {
        types: ['heading', 'figure', 'table', 'image', 'callBlock', 'mathBlock', 'typstBlock'],
        attributes: {
          label: { default: null, rendered: false },
          labelSep: { default: null, rendered: false },
        },
      },
    ];
  },
});

const DocumentNode = Document.extend({ content: 'block+' });

const ParagraphNode = Paragraph.extend({});

const HeadingNode = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** Original-Markierung (`=` mit Leerzeichen danach), nur für die Rücküberführung. */
      raw: { default: null, rendered: false },
    };
  },
}).configure({ levels: [1, 2, 3, 4, 5, 6] });

const BulletListNode = BulletList.extend({
  addAttributes() {
    return {
      tight: { default: true, rendered: false },
      marker: { default: '-', rendered: false },
    };
  },
});

const OrderedListNode = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: { default: true, rendered: false },
      /** `true`: Nummern stehen im Quelltext (`1.`), sonst `+`. */
      explicit: { default: false, rendered: false },
    };
  },
});

const ListItemNode = ListItem.extend({
  content: 'paragraph block*',
});

const CodeBlockNode = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fence: { default: '```', rendered: false },
    };
  },
});

const BlockquoteNode = Blockquote.extend({
  addAttributes() {
    return { args: { default: null, rendered: false } };
  },
});

const HorizontalRuleNode = HorizontalRule.extend({
  addAttributes() {
    return { args: { default: null, rendered: false } };
  },
});

const TableNode = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** Ausdruck für `columns:` (z. B. `3` oder `(1fr, 2fr)`). */
      columns: { default: null, rendered: false },
      /** Weitere benannte Argumente, unverändert. */
      rest: { default: null, rendered: false },
      /** `table` oder `grid`. */
      func: { default: 'table', rendered: false },
      /** Innerhalb einer Abbildung ohne `#`. */
      code: { default: false, rendered: false },
    };
  },
}).configure({ resizable: false, allowTableNodeSelection: true });

export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      width: { default: null },
      height: { default: null },
      rest: { default: null },
      code: { default: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        // Bilder aus dem Web oder als data:-URL kann Typst nicht laden: beim Einfügen weglassen
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute('src') ?? '';
          return /^(https?:|data:|blob:|tw:)/.test(src) ? false : { src };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes({ class: 'tw-image' }, { src: HTMLAttributes.src })];
  },
});

export const FigureNode = Node.create({
  name: 'figure',
  group: 'block',
  content: '(image | table) figcaption?',
  isolating: true,
  draggable: true,
  addAttributes() {
    return {
      rest: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'figure' }];
  },
  renderHTML() {
    return ['figure', { class: 'tw-figure' }, 0];
  },
});

export const FigcaptionNode = Node.create({
  name: 'figcaption',
  content: 'inline*',
  isolating: true,
  parseHTML() {
    return [{ tag: 'figcaption' }];
  },
  renderHTML() {
    return ['figcaption', { class: 'tw-figcaption' }, 0];
  },
});

export const MathBlockNode = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { src: { default: '$ $' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-math-block]', getAttrs: (el) => ({ src: (el as HTMLElement).dataset.src }) }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-math-block': '', 'data-src': node.attrs.src, class: 'tw-math-block' }, node.attrs.src];
  },
});

export const MathInlineNode = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { src: { default: '$x$' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-math-inline]', getAttrs: (el) => ({ src: (el as HTMLElement).dataset.src }) }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-math-inline': '', 'data-src': node.attrs.src, class: 'tw-math-inline' }, node.attrs.src];
  },
});

/** Typst-Code, den der Editor nicht als Text versteht: wird gerendert oder als Code gezeigt. */
export const TypstBlockNode = Node.create({
  name: 'typstBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      /** `code` (Vorlage: let/set/show/import), `expr` (erzeugt Inhalt), `include`, `comment`. */
      kind: { default: 'expr' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-typst-block]',
        getAttrs: (el) => ({ src: (el as HTMLElement).dataset.src, kind: (el as HTMLElement).dataset.kind }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'div',
      { 'data-typst-block': '', 'data-src': node.attrs.src, 'data-kind': node.attrs.kind, class: 'tw-typst-block' },
      node.attrs.src,
    ];
  },
});

export const TypstInlineNode = Node.create({
  name: 'typstInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      src: { default: '' },
      /** `expr`, `ref`, `label`, `comment`, `raw`. */
      kind: { default: 'expr' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-typst-inline]',
        getAttrs: (el) => ({ src: (el as HTMLElement).dataset.src, kind: (el as HTMLElement).dataset.kind }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'span',
      { 'data-typst-inline': '', 'data-src': node.attrs.src, 'data-kind': node.attrs.kind, class: 'tw-typst-inline' },
      node.attrs.src,
    ];
  },
});

/** Eigene Funktion mit Inhaltsblock, z. B. `#txt[...]`: der Inhalt bleibt editierbar. */
export const CallBlockNode = Node.create({
  name: 'callBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      callee: { default: 'block' },
      args: { default: null },
      /** Leerraum direkt nach `[` und vor `]`. */
      lead: { default: '\n' },
      trail: { default: '\n' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-call]',
        getAttrs: (el) => ({ callee: (el as HTMLElement).dataset.call, args: (el as HTMLElement).dataset.args || null }),
      },
    ];
  },
  renderHTML({ node }) {
    return ['div', { 'data-call': node.attrs.callee, class: `tw-call tw-call-${node.attrs.callee}` }, 0];
  },
});

export const PageBreakNode = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  addAttributes() {
    return { args: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'tw-page-break' }];
  },
});

export const TocNode = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  addAttributes() {
    return { args: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },
  renderHTML() {
    return ['div', { 'data-toc': '', class: 'tw-toc' }, 'Contents'];
  },
});

// ---------------------------------------------------------------- Marks

/** `#text(...)[...]`: Argumente bleiben als Typst-Ausdrücke erhalten. */
export const TextStyleMark = Mark.create({
  name: 'textStyle',
  priority: 900,
  excludes: '',
  addAttributes() {
    return {
      fill: { default: null },
      size: { default: null },
      font: { default: null },
      weight: { default: null },
      rest: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[style]',
        getAttrs: (el) => {
          const s = (el as HTMLElement).style;
          const attrs: Record<string, string | null> = { fill: null, size: null, font: null, weight: null };
          if (s.color) attrs.fill = cssColorToTypst(s.color);
          if (s.fontSize && /pt$/.test(s.fontSize)) attrs.size = s.fontSize;
          if (s.fontFamily) attrs.font = JSON.stringify(s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
          if (!attrs.fill && !attrs.size && !attrs.font) return false;
          return attrs;
        },
      },
    ];
  },
  renderHTML({ mark }) {
    const style: string[] = [];
    const color = mark.attrs.fill ? typstColorToCss(mark.attrs.fill) : null;
    if (color) style.push(`color: ${color}`);
    if (mark.attrs.size && /^[\d.]+pt$/.test(mark.attrs.size)) style.push(`font-size: ${mark.attrs.size}`);
    if (mark.attrs.font) {
      const fam = String(mark.attrs.font).replace(/^\(|\)$/g, '');
      style.push(`font-family: ${fam}`);
    }
    if (mark.attrs.weight) {
      const w = String(mark.attrs.weight).replace(/"/g, '');
      const map: Record<string, string> = { bold: '700', semibold: '600', medium: '500', regular: '400', light: '300' };
      style.push(`font-weight: ${map[w] ?? w}`);
    }
    return ['span', { style: style.join('; '), class: 'tw-text-style' }, 0];
  },
});

export const HighlightMark = Mark.create({
  name: 'highlight',
  priority: 890,
  excludes: '',
  addAttributes() {
    return { fill: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ mark }) {
    const color = mark.attrs.fill ? typstColorToCss(mark.attrs.fill) : null;
    return ['mark', { class: 'tw-highlight', style: color ? `background-color: ${color}` : '' }, 0];
  },
});

export const SmallcapsMark = Mark.create({
  name: 'smallcaps',
  priority: 860,
  parseHTML() {
    return [{ style: 'font-variant=small-caps' }];
  },
  renderHTML() {
    return ['span', { style: 'font-variant: small-caps' }, 0];
  },
});

/** Eigene Inline-Funktion mit Inhaltsblock, z. B. `#offen[...]` oder `#footnote[...]`. */
export const CallMark = Mark.create({
  name: 'callMark',
  priority: 950,
  excludes: '',
  inclusive: false,
  addAttributes() {
    return { callee: { default: 'box' }, args: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-call-mark]',
        getAttrs: (el) => ({
          callee: (el as HTMLElement).dataset.callMark,
          args: (el as HTMLElement).dataset.args || null,
        }),
      },
    ];
  },
  renderHTML({ mark }) {
    return [
      'span',
      {
        'data-call-mark': mark.attrs.callee,
        'data-args': mark.attrs.args ?? '',
        title: `#${mark.attrs.callee}${mark.attrs.args ?? ''}[…]`,
        class: `tw-call-mark tw-call-mark-${mark.attrs.callee}`,
      },
      0,
    ];
  },
});

const LinkMark = Link.extend({
  inclusive: false,
  addAttributes() {
    return {
      href: { default: null },
      /** `bare` (URL direkt im Text) oder `call` (`#link(...)`). */
      form: { default: null, rendered: false },
    };
  },
}).configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { target: null, rel: null } });

const CodeMark = Code.extend({ excludes: '', priority: 700 });
const BoldMark = Bold.extend({ priority: 760 });
const ItalicMark = Italic.extend({ priority: 750 });
const UnderlineMark = Underline.extend({ priority: 880 });
const StrikeMark = Strike.extend({ priority: 870 });
const SuperscriptMark = Superscript.extend({ priority: 850, excludes: 'subscript' });
const SubscriptMark = Subscript.extend({ priority: 840, excludes: 'superscript' });

export function cssColorToTypst(css: string): string | null {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return `rgb("#${hex}")`;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(css)) return `rgb("${css}")`;
  return null;
}

/** Alle Erweiterungen, die das Schema bilden (ohne UI-Verhalten wie Tastenkürzel-Extras). */
export function schemaExtensions(): AnyExtension[] {
  return [
    DocumentNode,
    ParagraphNode,
    Text,
    HeadingNode,
    BulletListNode,
    OrderedListNode,
    ListItemNode,
    CodeBlockNode,
    BlockquoteNode,
    HorizontalRuleNode,
    HardBreak,
    TableNode,
    TableRow,
    TableHeader,
    TableCell,
    ImageNode,
    FigureNode,
    FigcaptionNode,
    MathBlockNode,
    MathInlineNode,
    TypstBlockNode,
    TypstInlineNode,
    CallBlockNode,
    PageBreakNode,
    TocNode,
    LinkMark,
    CallMark,
    TextStyleMark,
    HighlightMark,
    UnderlineMark,
    StrikeMark,
    SmallcapsMark,
    SuperscriptMark,
    SubscriptMark,
    BoldMark,
    ItalicMark,
    CodeMark,
    SepAttribute,
  ];
}

/** Schema plus Editor-Verhalten (Undo, Listen-Tastatur, Cursor an Blockgrenzen). */
export function editorExtensions(): AnyExtension[] {
  return [
    ...schemaExtensions(),
    UndoRedo.configure({ depth: 300 }),
    ListKeymap,
    Dropcursor.configure({ color: '#2b579a', width: 2 }),
    Gapcursor,
    TrailingNode.configure({ node: 'paragraph' }),
  ];
}
