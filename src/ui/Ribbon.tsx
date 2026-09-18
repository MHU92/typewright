// Word-style ribbon: File, Home, Insert, Layout, View (+ Table when the cursor is in a table).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  BookOpen,
  ChevronDown,
  ClipboardPaste,
  Code,
  Code2,
  Columns3,
  Copy,
  Eraser,
  Eye,
  FileCode2,
  FileDown,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Outdent,
  PaintbrushVertical,
  PanelLeft,
  PanelRight,
  Pilcrow,
  Printer,
  Quote,
  Redo2,
  RulerDimensionLine,
  Scissors,
  Search,
  Sigma,
  SquareSplitVertical,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  TableOfContents,
  Type,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
  Replace,
  SquareFunction,
  Footprints,
  Bookmark,
  Rows3,
  Columns2,
  Trash2,
  Merge,
  Split,
  Heading,
  FileText,
  Variable,
  MessageSquarePlus,
  Sparkles,
} from 'lucide-react';
import { editCode } from '../editor/context';
import type { Geometry } from '../render/snippets';
import { AGENT_NAMES, type MenuCommand, type Settings } from '../shared/api';
import {
  collectLabels,
  currentAlign,
  currentBlockStyle,
  insertFigure,
  insertMath,
  insertRef,
  insertTypst,
  onPainterChange,
  setAlignWithDefault,
  setBlockStyle,
  setHighlight,
  setTextStyle,
  startFormatPainter,
} from '../editor/commands';
import { typstColorToCss, cssHexToTypst, lengthToPt, readStringLiteral } from '../typst/values';
import { readSetArg, writeSetArgs } from '../typst/preamble';
import { t } from '../i18n';

type Tab = 'start' | 'insert' | 'layout' | 'view' | 'table';

interface RibbonProps {
  editor: Editor;
  settings: Settings;
  geometry: Geometry | null;
  onCommand: (c: MenuCommand) => void;
  onSettings: (patch: Partial<Settings>) => void;
  onBackstage: () => void;
  onPickImage: () => void;
  onTable: () => void;
  isChapter: boolean;
  mainFile: string | null;
}

export function Ribbon(props: RibbonProps) {
  const { editor } = props;
  const [tab, setTab] = useState<Tab>('start');
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => e?.isActive('table') ?? false });
  useEffect(() => {
    if (!inTable && tab === 'table') setTab('start');
  }, [inTable, tab]);

  const agentLabel = props.settings.agent === 'claude' ? 'Claude' : AGENT_NAMES[props.settings.agent];
  return (
    <div className="tw-ribbon">
      <div className="tw-ribbon-tabs">
        <button className="tw-tab tw-tab-file" onClick={props.onBackstage}>
          {t('File')}
        </button>
        {(
          [
            ['start', t('Home')],
            ['insert', t('Insert')],
            ['layout', t('Layout')],
            ['view', t('View')],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`tw-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        {inTable && (
          <button className={`tw-tab tw-tab-context ${tab === 'table' ? 'is-active' : ''}`} onClick={() => setTab('table')}>
            {t('Table')}
          </button>
        )}
        <div className="tw-tab-spacer" />
        <button
          className={`tw-claude-toggle ${props.settings.showClaude ? 'is-on' : ''}`}
          title={t('AI in the editor (⌘J) · send selection with ⌘L')}
          onClick={() => props.onCommand('toggle-claude')}
        >
          <Sparkles size={14} /> {agentLabel}
        </button>
      </div>
      <div className="tw-ribbon-body">
        {tab === 'start' && <StartTab {...props} />}
        {tab === 'insert' && <InsertTab {...props} />}
        {tab === 'layout' && <LayoutTab {...props} />}
        {tab === 'view' && <ViewTab {...props} />}
        {tab === 'table' && <TableTab {...props} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Building blocks

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tw-group">
      <div className="tw-group-body">{children}</div>
      <div className="tw-group-label">{label}</div>
    </div>
  );
}

function Btn({
  icon,
  label,
  title,
  active,
  onClick,
  large,
  disabled,
}: {
  icon?: ReactNode;
  label?: string;
  title?: string;
  active?: boolean;
  onClick: () => void;
  large?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`tw-btn ${large ? 'tw-btn-large' : ''} ${active ? 'is-on' : ''}`}
      title={title ?? label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

function Dropdown({
  button,
  children,
  title,
  className,
}: {
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className={`tw-dropdown ${className ?? ''}`} ref={ref}>
      <button className={`tw-btn tw-dd-btn ${open ? 'is-on' : ''}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {button}
        <ChevronDown size={11} className="tw-dd-caret" />
      </button>
      {open && <div className="tw-dd-menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050',
  '#00b0f0', '#0070c0', '#002060', '#7030a0', '#1e5ae8', '#f0553f',
];

const HIGHLIGHTS = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#c6e0ff', '#ffd6d6', '#fff0b3', '#d9d9d9'];

function ColorGrid({ colors, onPick, onAuto, autoLabel, onCustom }: { colors: string[]; onPick: (c: string) => void; onAuto: () => void; autoLabel: string; onCustom?: (c: string) => void }) {
  return (
    <div className="tw-colors">
      <button className="tw-color-auto" onMouseDown={(e) => e.preventDefault()} onClick={onAuto}>
        {autoLabel}
      </button>
      <div className="tw-color-grid">
        {colors.map((c) => (
          <button key={c} className="tw-color" style={{ background: c }} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} />
        ))}
      </div>
      {onCustom && (
        <label className="tw-color-custom">
          {t('More colors …')}
          <input type="color" onChange={(e) => onCustom(e.target.value)} />
        </label>
      )}
    </div>
  );
}

const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

let fontPromise: Promise<string[]> | null = null;
function useFonts() {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    fontPromise ??= window.tw.fonts();
    void fontPromise.then(setFonts);
  }, []);
  return fonts;
}

// ------------------------------------------------------------------ Home

function StartTab({ editor, geometry, settings, onCommand, onSettings }: RibbonProps) {
  const fonts = useFonts();
  const [painter, setPainter] = useState(false);
  const lastColor = useRef('#c00000');
  const lastHighlight = useRef('#ffff00');
  useEffect(() => onPainterChange(setPainter), []);
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const ts = e.getAttributes('textStyle');
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        sup: e.isActive('superscript'),
        sub: e.isActive('subscript'),
        code: e.isActive('code'),
        smallcaps: e.isActive('smallcaps'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        font: (ts.font as string | null) ?? null,
        size: (ts.size as string | null) ?? null,
        fill: (ts.fill as string | null) ?? null,
        highlight: e.isActive('highlight') ? ((e.getAttributes('highlight').fill as string | null) ?? '#ffff00') : null,
        align: currentAlign(e, !!geometry?.justify),
        block: currentBlockStyle(e),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });
  if (!st) return null;
  const defaultFont = geometry?.font?.[0] ?? 'Libertinus Serif';
  const fontName = st.font ? (readStringLiteral(st.font.replace(/^\(|\)$/g, '').split(',')[0]) ?? st.font) : defaultFont;
  const sizePt = st.size ? lengthToPt(st.size) : (geometry?.size ?? 11);
  const familyNames = fonts.length ? fonts : [defaultFont];

  const grow = (dir: 1 | -1) => {
    const cur = sizePt ?? 11;
    const idx = SIZES.findIndex((s) => s >= cur);
    const next = dir > 0 ? SIZES[Math.min(SIZES.length - 1, (SIZES[idx] === cur ? idx : idx - 1) + 1)] : SIZES[Math.max(0, (idx < 0 ? SIZES.length : idx) - 1)];
    setTextStyle(editor, { size: `${next}pt` });
  };

  const styles: [string, string, string][] = [
    ['paragraph', t('Normal'), 'tw-style-p'],
    ['h1', t('Heading 1'), 'tw-style-h1'],
    ['h2', t('Heading 2'), 'tw-style-h2'],
    ['h3', t('Heading 3'), 'tw-style-h3'],
    ['h4', t('Heading 4'), 'tw-style-h4'],
    ['quote', t('Quote'), 'tw-style-quote'],
    ['code', t('Code'), 'tw-style-code'],
  ];

  return (
    <>
      <Group label={t('Undo')}>
        <div className="tw-stack">
          <Btn icon={<Undo2 size={15} />} label={t('Undo')} title={t('Undo (⌘Z)')} disabled={!st.canUndo} onClick={() => onCommand('undo')} />
          <Btn icon={<Redo2 size={15} />} label={t('Redo')} title={t('Redo (⇧⌘Z)')} disabled={!st.canRedo} onClick={() => onCommand('redo')} />
        </div>
      </Group>
      <Group label={t('Clipboard')}>
        <Btn large icon={<ClipboardPaste size={22} />} label={t('Paste')} onClick={() => document.execCommand('paste')} />
        <div className="tw-stack">
          <Btn icon={<Scissors size={14} />} title={t('Cut (⌘X)')} onClick={() => document.execCommand('cut')} />
          <Btn icon={<Copy size={14} />} title={t('Copy (⌘C)')} onClick={() => document.execCommand('copy')} />
          <Btn icon={<PaintbrushVertical size={14} />} title={t('Format Painter')} active={painter} onClick={() => startFormatPainter(editor)} />
        </div>
      </Group>

      <Group label={t('Font')}>
        <div className="tw-font-row">
          <select
            className="tw-select tw-font-select"
            value={familyNames.find((f) => f.toLowerCase() === fontName.toLowerCase()) ?? fontName}
            onChange={(e) => setTextStyle(editor, { font: e.target.value.toLowerCase() === defaultFont.toLowerCase() ? null : JSON.stringify(e.target.value) })}
            style={{ fontFamily: fontName }}
          >
            {!familyNames.some((f) => f.toLowerCase() === fontName.toLowerCase()) && <option value={fontName}>{fontName}</option>}
            {familyNames.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            className="tw-select tw-size-select"
            value={sizePt ? String(Math.round(sizePt * 10) / 10) : ''}
            onChange={(e) => setTextStyle(editor, { size: `${e.target.value}pt` })}
          >
            {sizePt && !SIZES.includes(Math.round(sizePt * 10) / 10) && <option value={String(Math.round(sizePt * 10) / 10)}>{Math.round(sizePt * 10) / 10}</option>}
            {SIZES.map((s) => (
              <option key={s} value={String(s)}>
                {s}
              </option>
            ))}
          </select>
          <Btn icon={<span className="tw-grow">A<sup>+</sup></span>} title={t('Increase font size')} onClick={() => grow(1)} />
          <Btn icon={<span className="tw-grow small">A<sup>−</sup></span>} title={t('Decrease font size')} onClick={() => grow(-1)} />
          <Btn icon={<Eraser size={15} />} title={t('Clear formatting (⌘\\)')} onClick={() => onCommand('clear-format')} />
        </div>
        <div className="tw-font-row">
          <Btn icon={<Bold size={15} />} title={t('Bold (⌘B)')} active={st.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
          <Btn icon={<Italic size={15} />} title={t('Italic (⌘I)')} active={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <Btn icon={<Underline size={15} />} title={t('Underline (⌘U)')} active={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <Btn icon={<Strikethrough size={15} />} title={t('Strikethrough (⇧⌘X)')} active={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <Btn icon={<Subscript size={15} />} title={t('Subscript (⌘,)')} active={st.sub} onClick={() => editor.chain().focus().toggleSubscript().run()} />
          <Btn icon={<Superscript size={15} />} title={t('Superscript (⌘.)')} active={st.sup} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
          <Btn icon={<span className="tw-smallcaps">Kk</span>} title={t('Small caps')} active={st.smallcaps} onClick={() => editor.chain().focus().toggleMark('smallcaps').run()} />
          <Btn icon={<Code size={15} />} title={t('Code (raw)')} active={st.code} onClick={() => editor.chain().focus().toggleCode().run()} />
          <span className="tw-sep" />
          <div className="tw-split">
            <Btn
              icon={
                <span className="tw-colored">
                  <Highlighter size={15} />
                  <i style={{ background: st.highlight ? (typstColorToCss(st.highlight) ?? '#ff0') : lastHighlight.current }} />
                </span>
              }
              title={t('Text highlight color')}
              onClick={() => setHighlight(editor, cssHexToTypst(lastHighlight.current))}
            />
            <Dropdown button={null} title={t('Choose highlight color')} className="tw-split-dd">
              {(close) => (
                <ColorGrid
                  colors={HIGHLIGHTS}
                  autoLabel={t('No color')}
                  onAuto={() => (setHighlight(editor, undefined), close())}
                  onPick={(c) => {
                    lastHighlight.current = c;
                    setHighlight(editor, c === '#ffff00' ? null : cssHexToTypst(c));
                    close();
                  }}
                />
              )}
            </Dropdown>
          </div>
          <div className="tw-split">
            <Btn
              icon={
                <span className="tw-colored">
                  <Baseline size={15} />
                  <i style={{ background: st.fill ? (typstColorToCss(st.fill) ?? '#c00000') : lastColor.current }} />
                </span>
              }
              title={t('Font color')}
              onClick={() => setTextStyle(editor, { fill: cssHexToTypst(lastColor.current) })}
            />
            <Dropdown button={null} title={t('Choose font color')} className="tw-split-dd">
              {(close) => (
                <ColorGrid
                  colors={TEXT_COLORS}
                  autoLabel={t('Automatic')}
                  onAuto={() => (setTextStyle(editor, { fill: null }), close())}
                  onPick={(c) => {
                    lastColor.current = c;
                    setTextStyle(editor, { fill: cssHexToTypst(c) });
                    close();
                  }}
                  onCustom={(c) => {
                    lastColor.current = c;
                    setTextStyle(editor, { fill: cssHexToTypst(c) });
                  }}
                />
              )}
            </Dropdown>
          </div>
        </div>
      </Group>

      <Group label={t('Paragraph')}>
        <div className="tw-font-row">
          <Btn icon={<List size={15} />} title={t('Bullets')} active={st.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <Btn icon={<ListOrdered size={15} />} title={t('Numbering')} active={st.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <Btn icon={<Outdent size={15} />} title={t('Decrease indent (⇧Tab)')} onClick={() => editor.chain().focus().liftListItem('listItem').run()} />
          <Btn icon={<Indent size={15} />} title={t('Increase indent (Tab)')} onClick={() => editor.chain().focus().sinkListItem('listItem').run()} />
          <span className="tw-sep" />
          <Btn icon={<Pilcrow size={15} />} title={t('Show structure (⌘8)')} active={settings.showMarks} onClick={() => onSettings({ showMarks: !settings.showMarks })} />
        </div>
        <div className="tw-font-row">
          <Btn icon={<AlignLeft size={15} />} title={t('Align left (⇧⌘L)')} active={st.align === 'left'} onClick={() => setAlignWithDefault(editor, 'left', !!geometry?.justify)} />
          <Btn icon={<AlignCenter size={15} />} title={t('Center (⇧⌘E)')} active={st.align === 'center'} onClick={() => setAlignWithDefault(editor, 'center', !!geometry?.justify)} />
          <Btn icon={<AlignRight size={15} />} title={t('Align right (⇧⌘R)')} active={st.align === 'right'} onClick={() => setAlignWithDefault(editor, 'right', !!geometry?.justify)} />
          <Btn icon={<AlignJustify size={15} />} title={t('Justify (⇧⌘J)')} active={st.align === 'justify'} onClick={() => setAlignWithDefault(editor, 'justify', !!geometry?.justify)} />
          <span className="tw-sep" />
          <Btn icon={<Quote size={15} />} title={t('Quote')} active={st.block === 'quote'} onClick={() => setBlockStyle(editor, 'quote')} />
        </div>
      </Group>

      <Group label={t('Styles')}>
        <div className="tw-styles">
          {styles.map(([id, label, cls]) => (
            <button
              key={id}
              className={`tw-style-tile ${cls} ${st.block === id ? 'is-on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setBlockStyle(editor, id)}
              title={label}
            >
              <span className="tw-style-sample">AaBbCc</span>
              <span className="tw-style-name">{label}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group label={t('Editing')}>
        <div className="tw-stack">
          <Btn icon={<Search size={14} />} label={t('Find')} onClick={() => onCommand('find')} />
          <Btn icon={<Replace size={14} />} label={t('Replace')} onClick={() => onCommand('replace')} />
        </div>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Insert

const SYMBOLS = ['–', '—', '…', '„', '“', '‚', '‘', '»', '«', '€', '§', '©', '®', '™', '°', '±', '×', '÷', '→', '←', '↑', '↓', '⇒', '≈', '≠', '≤', '≥', '∞', '√', '½', '¼', '¾', '•', '·', '✓', '✗', ' '];

function InsertTab({ editor, onCommand, onPickImage, onTable }: RibbonProps) {
  const [labels, setLabels] = useState<{ label: string; text: string; type: string }[]>([]);
  return (
    <>
      <Group label={t('Pages')}>
        <Btn large icon={<SquareSplitVertical size={22} />} label={t('Page Break')} title={t('Page break (⌘↩)')} onClick={() => onCommand('insert-pagebreak')} />
        <Btn large icon={<TableOfContents size={22} />} label={t('Contents')} title={t('Table of contents')} onClick={() => onCommand('insert-toc')} />
      </Group>
      <Group label={t('Tables')}>
        <TablePicker editor={editor} onMore={onTable} />
      </Group>
      <Group label={t('Illustrations')}>
        <Btn large icon={<ImageIcon size={22} />} label={t('Picture')} onClick={onPickImage} />
        <Btn
          large
          icon={<BookOpen size={22} />}
          label={t('Figure')}
          title={t('Picture with caption')}
          onClick={async () => {
            const src = await window.tw.pickImage();
            if (src) insertFigure(editor, src);
          }}
        />
      </Group>
      <Group label={t('Links')}>
        <Btn large icon={<Link2 size={22} />} label={t('Link')} title={t('Link (⌘K)')} onClick={() => onCommand('insert-link')} />
        <Dropdown
          button={
            <span className="tw-btn-large-inner">
              <Bookmark size={22} />
              <span>{t('Cross-ref')}</span>
            </span>
          }
          className="tw-dd-large"
        >
          {(close) => {
            if (!labels.length) setTimeout(() => setLabels(collectLabels(editor)), 0);
            return (
              <div className="tw-menu-list">
                {labels.length === 0 && <div className="tw-menu-empty">{t('No labels yet. Add one after a heading, e.g. <intro>.')}</div>}
                {labels.map((l) => (
                  <button
                    key={l.label}
                    onClick={() => {
                      insertRef(editor, l.label);
                      close();
                    }}
                  >
                    <b>@{l.label}</b> <span>{l.text}</span>
                  </button>
                ))}
              </div>
            );
          }}
        </Dropdown>
        <Btn large icon={<Footprints size={22} />} label={t('Footnote')} title={t('Footnote (⌥⌘F)')} onClick={() => onCommand('insert-footnote')} />
      </Group>
      <Group label={t('Math & Code')}>
        <Btn large icon={<Sigma size={22} />} label={t('Equation')} title={t('Inline equation (⌃⌘M)')} onClick={() => insertMath(editor, false)} />
        <Btn large icon={<SquareFunction size={22} />} label={t('Display')} title={t('Display equation')} onClick={() => insertMath(editor, true)} />
        <Btn large icon={<Code2 size={22} />} label={t('Code Block')} onClick={() => onCommand('insert-code')} />
        <Btn large icon={<FileCode2 size={22} />} label={t('Typst Code')} onClick={() => insertTypst(editor)} />
      </Group>
      <Group label={t('Text')}>
        <Btn
          large
          icon={<MessageSquarePlus size={22} />}
          label={t('Comment')}
          title={t('Comment (not shown in the PDF)')}
          onClick={() => {
            editor.chain().focus().insertContent({ type: 'typstBlock', attrs: { src: '// ', kind: 'comment' } }).run();
            const pos = editor.state.selection.from - 1;
            editCode({
              title: t('Comment'),
              hint: t('A Typst comment: it lives in the source only, not in the PDF. Every line starts with //.'),
              code: '// ',
              onSave: (code) => {
                const node = editor.state.doc.nodeAt(pos);
                const text = code
                  .split('\n')
                  .map((l) => (l.trim().startsWith('//') ? l : `// ${l}`))
                  .join('\n');
                if (node?.type.name === 'typstBlock') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: text }));
              },
            });
          }}
        />
        <Btn large icon={<Minus size={22} />} label={t('Line')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <Dropdown
          button={
            <span className="tw-btn-large-inner">
              <span className="tw-omega">Ω</span>
              <span>{t('Symbol')}</span>
            </span>
          }
          className="tw-dd-large"
        >
          {(close) => (
            <div className="tw-symbols">
              {SYMBOLS.map((s) => (
                <button
                  key={s}
                  title={s === ' ' ? t('Non-breaking space') : s}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().focus().insertContent(s).run();
                    close();
                  }}
                >
                  {s === ' ' ? '⍽' : s}
                </button>
              ))}
            </div>
          )}
        </Dropdown>
      </Group>
    </>
  );
}

function TablePicker({ editor, onMore }: { editor: Editor; onMore: () => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <Dropdown
      button={
        <span className="tw-btn-large-inner">
          <TableIcon size={22} />
          <span>{t('Table')}</span>
        </span>
      }
      className="tw-dd-large"
    >
      {(close) => (
        <div className="tw-table-picker">
          <div className="tw-table-picker-label">{hover[0] ? t('{cols} × {rows} table', { cols: hover[1], rows: hover[0] }) : t('Insert table')}</div>
          <div className="tw-table-grid" onMouseLeave={() => setHover([0, 0])}>
            {Array.from({ length: 8 }).map((_, r) =>
              Array.from({ length: 10 }).map((__, c) => (
                <div
                  key={`${r}-${c}`}
                  className={`tw-table-cell ${r < hover[0] && c < hover[1] ? 'on' : ''}`}
                  onMouseEnter={() => setHover([r + 1, c + 1])}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().focus().insertTable({ rows: r + 1, cols: c + 1, withHeaderRow: true }).run();
                    close();
                  }}
                />
              )),
            )}
          </div>
          <button
            className="tw-menu-item"
            onClick={() => {
              close();
              onMore();
            }}
          >
            {t('Insert table …')}
          </button>
        </div>
      )}
    </Dropdown>
  );
}

// ------------------------------------------------------------------ Layout

const LANGS: [string, string][] = [
  ['en', 'English'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
];

function LayoutTab({ editor, geometry, isChapter, mainFile }: RibbonProps) {
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const set = (func: 'page' | 'text' | 'par' | 'heading', values: Record<string, string | null>) => void writeSetArgs(editor, func, values);
  useEffect(() => {
    void (async () => {
      const h = await readSetArg(editor, 'page', 'header');
      const f = await readSetArg(editor, 'page', 'footer');
      setHeader(h && /^\[[^\[\]]*\]$/.test(h) ? h.slice(1, -1) : h ? CODE_MARK : '');
      setFooter(f && /^\[[^\[\]]*\]$/.test(f) ? f.slice(1, -1) : f ? CODE_MARK : '');
    })();
  }, [editor]);

  if (isChapter) {
    return (
      <div className="tw-ribbon-note">
        <FileText size={16} />
        <span>{t('This file is a chapter. Page, font and paragraph settings come from {file}.', { file: mainFile?.split('/').pop() ?? '' })}</span>
        <button className="tw-btn" onClick={() => mainFile && void window.tw.openPath(mainFile)}>
          {t('Open main file')}
        </button>
      </div>
    );
  }
  const g = geometry;
  const cm = (pt: number) => String(Math.round((pt / 72) * 2.54 * 100) / 100);
  const margins: [string, string, string | null][] = [
    [t('Normal'), t('2.5 cm all around'), '2.5cm'],
    [t('Narrow'), t('1.27 cm all around'), '1.27cm'],
    [t('Moderate'), '2.54 / 1.91 cm', '(x: 1.91cm, y: 2.54cm)'],
    [t('Wide'), '2.54 / 5.08 cm', '(x: 5.08cm, y: 2.54cm)'],
    [t('Typst default'), t('automatic'), null],
  ];
  const papers: [string, string][] = [
    ['a4', 'A4 (21 × 29.7 cm)'],
    ['a5', 'A5 (14.8 × 21 cm)'],
    ['a3', 'A3 (29.7 × 42 cm)'],
    ['us-letter', 'US Letter'],
    ['us-legal', 'US Legal'],
    ['presentation-16-9', t('Slide 16:9')],
  ];
  const numberings: [string | null, string][] = [
    [null, t('None')],
    ['"1."', '1. / 1.1.'],
    ['"1.1"', '1 / 1.1'],
    ['"1.a)"', '1. / a)'],
    ['"I."', 'I. / II.'],
    ['"A."', 'A. / B.'],
  ];
  return (
    <>
      <Group label={t('Page Setup')}>
        <Dropdown
          button={
            <span className="tw-btn-large-inner">
              <RulerDimensionLine size={22} />
              <span>{t('Margins')}</span>
            </span>
          }
          className="tw-dd-large"
        >
          {(close) => (
            <div className="tw-menu-list">
              {g && (
                <div className="tw-menu-empty">
                  {t('Current: left {l} · right {r} · top {t} · bottom {b} cm', { l: cm(g.marginLeft), r: cm(g.marginRight), t: cm(g.marginTop), b: cm(g.marginBottom) })}
                </div>
              )}
              {margins.map(([name, desc, value]) => (
                <button
                  key={name}
                  onClick={() => {
                    set('page', { margin: value });
                    close();
                  }}
                >
                  <b>{name}</b> <span>{desc}</span>
                </button>
              ))}
            </div>
          )}
        </Dropdown>
        <div className="tw-stack">
          <Btn icon={<FileText size={14} />} label={t('Portrait')} active={!!g && !g.flipped} onClick={() => set('page', { flipped: null })} />
          <Btn icon={<FileText size={14} style={{ transform: 'rotate(90deg)' }} />} label={t('Landscape')} active={!!g?.flipped} onClick={() => set('page', { flipped: 'true' })} />
        </div>
        <div className="tw-stack">
          <label className="tw-field">
            {t('Size')}
            <select className="tw-select" defaultValue="" onChange={(e) => e.target.value && set('page', { paper: JSON.stringify(e.target.value) })}>
              <option value="">{g ? `${cm(g.pageWidth)} × ${cm(g.pageHeight)} cm` : t('Size')}</option>
              {papers.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="tw-field">
            {t('Columns')}
            <select className="tw-select" value={String(g?.columns ?? 1)} onChange={(e) => set('page', { columns: e.target.value === '1' ? null : e.target.value })}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Group>
      <Group label={t('Header & Footer')}>
        <div className="tw-stack">
          <label className="tw-field">
            {t('Header')}
            <input
              className="tw-input"
              value={header === CODE_MARK ? t('(code)') : header}
              disabled={header === CODE_MARK}
              placeholder={t('none')}
              onChange={(e) => setHeader(e.target.value)}
              onBlur={() => header !== CODE_MARK && set('page', { header: header ? `[${header}]` : null })}
            />
          </label>
          <label className="tw-field">
            {t('Footer')}
            <input
              className="tw-input"
              value={footer === CODE_MARK ? t('(code)') : footer}
              disabled={footer === CODE_MARK}
              placeholder={t('none')}
              onChange={(e) => setFooter(e.target.value)}
              onBlur={() => footer !== CODE_MARK && set('page', { footer: footer ? `[${footer}]` : null })}
            />
          </label>
        </div>
        <label className="tw-field tw-field-col">
          {t('Page numbers')}
          <select className="tw-select" defaultValue="" onChange={(e) => set('page', { numbering: e.target.value === 'none' ? null : e.target.value })}>
            <option value="">{t('choose …')}</option>
            <option value="none">{t('None')}</option>
            <option value={'"1"'}>1, 2, 3</option>
            <option value={'"1 / 1"'}>1 / 10</option>
            <option value={'"– 1 –"'}>– 1 –</option>
            <option value={'"i"'}>i, ii, iii</option>
          </select>
        </label>
      </Group>
      <Group label={t('Text')}>
        <div className="tw-stack">
          <label className="tw-field">
            {t('Size')}
            <select className="tw-select" value={g ? String(Math.round(g.size * 10) / 10) : ''} onChange={(e) => set('text', { size: `${e.target.value}pt` })}>
              {g && !SIZES.includes(Math.round(g.size * 10) / 10) && <option value={String(Math.round(g.size * 10) / 10)}>{Math.round(g.size * 10) / 10}</option>}
              {SIZES.slice(0, 9).map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
          </label>
          <label className="tw-field">
            {t('Language')}
            <select className="tw-select" value={g?.lang ?? 'en'} onChange={(e) => set('text', { lang: JSON.stringify(e.target.value) })}>
              {LANGS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <FontDefault editor={editor} current={g?.font?.[0] ?? null} />
      </Group>
      <Group label={t('Paragraph')}>
        <div className="tw-stack">
          <Btn icon={<AlignJustify size={14} />} label={t('Justify')} active={!!g?.justify} onClick={() => set('par', { justify: g?.justify ? null : 'true' })} />
          <label className="tw-field">
            {t('Line spacing')}
            <select className="tw-select" defaultValue="" onChange={(e) => e.target.value && set('par', { leading: e.target.value })}>
              <option value="">{g ? `${Math.round((g.leading / g.size) * 100) / 100} em` : '–'}</option>
              <option value="0.5em">{t('tight (0.5 em)')}</option>
              <option value="0.65em">{t('default (0.65 em)')}</option>
              <option value="0.8em">{t('1.15 lines (0.8 em)')}</option>
              <option value="1em">{t('1.5 lines (1 em)')}</option>
              <option value="1.4em">{t('double (1.4 em)')}</option>
            </select>
          </label>
          <label className="tw-field">
            {t('Paragraph spacing')}
            <select className="tw-select" defaultValue="" onChange={(e) => e.target.value && set('par', { spacing: e.target.value })}>
              <option value="">{g ? `${Math.round(g.spacing * 10) / 10} pt` : '–'}</option>
              <option value="0.65em">{t('small')}</option>
              <option value="1.2em">{t('default')}</option>
              <option value="1.8em">{t('large')}</option>
            </select>
          </label>
        </div>
      </Group>
      <Group label={t('Headings')}>
        <label className="tw-field tw-field-col">
          <span>
            <Heading size={13} /> {t('Numbering')}
          </span>
          <select className="tw-select" value={g?.headingNumbering ? JSON.stringify(g.headingNumbering) : ''} onChange={(e) => set('heading', { numbering: e.target.value || null })}>
            {numberings.map(([v, l]) => (
              <option key={l} value={v ?? ''}>
                {l}
              </option>
            ))}
            {g?.headingNumbering && !numberings.some(([v]) => v === JSON.stringify(g.headingNumbering)) && (
              <option value={JSON.stringify(g.headingNumbering)}>{g.headingNumbering}</option>
            )}
          </select>
        </label>
      </Group>
    </>
  );
}

/** Marker for header/footer values that are Typst code rather than plain text. */
const CODE_MARK = '\u0000code';

function FontDefault({ editor, current }: { editor: Editor; current: string | null }) {
  const fonts = useFonts();
  return (
    <label className="tw-field tw-field-col">
      {t('Default font')}
      <select
        className="tw-select tw-font-select"
        value={fonts.find((f) => f.toLowerCase() === (current ?? '').toLowerCase()) ?? current ?? ''}
        onChange={(e) => void writeSetArgs(editor, 'text', { font: JSON.stringify(e.target.value) })}
      >
        {current && !fonts.some((f) => f.toLowerCase() === current.toLowerCase()) && <option value={current}>{current}</option>}
        {fonts.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ View

function ViewTab({ settings, onSettings, onCommand }: RibbonProps) {
  return (
    <>
      <Group label={t('Panes')}>
        <Btn large icon={<PanelLeft size={22} />} label={t('Navigation')} active={settings.showNav} onClick={() => onSettings({ showNav: !settings.showNav })} />
        <Btn large icon={<PanelRight size={22} />} label={t('Preview')} active={settings.showPreview} onClick={() => onSettings({ showPreview: !settings.showPreview })} />
        <Btn large icon={<FileCode2 size={22} />} label={t('Source')} active={settings.showSource} onClick={() => onCommand('toggle-source')} />
        <Btn large icon={<ListTree size={22} />} label={t('Structure')} active={settings.showMarks} onClick={() => onSettings({ showMarks: !settings.showMarks })} />
        <Btn large icon={<Sparkles size={22} />} label={t('AI')} active={settings.showClaude} onClick={() => onCommand('toggle-claude')} />
      </Group>
      <Group label={t('Zoom')}>
        <Btn large icon={<ZoomOut size={22} />} label={t('Smaller')} onClick={() => onCommand('zoom-out')} />
        <Btn large icon={<Eye size={22} />} label="100 %" onClick={() => onCommand('zoom-reset')} />
        <Btn large icon={<ZoomIn size={22} />} label={t('Larger')} onClick={() => onCommand('zoom-in')} />
      </Group>
      <Group label="Typst">
        <Btn large icon={<Variable size={22} />} label={t('Inputs')} title={t('sys.inputs for preview and export')} onClick={() => onCommand('inputs')} />
        <Btn large icon={<FileDown size={22} />} label="PDF" title={t('Export as PDF (⌘E)')} onClick={() => onCommand('export-pdf')} />
        <Btn large icon={<Printer size={22} />} label={t('Print')} onClick={() => onCommand('print')} />
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ Table (contextual)

function TableTab({ editor }: RibbonProps) {
  const c = () => editor.chain().focus();
  return (
    <>
      <Group label={t('Rows & Columns')}>
        <Btn large icon={<Rows3 size={22} />} label={t('Row above')} onClick={() => c().addRowBefore().run()} />
        <Btn large icon={<Rows3 size={22} />} label={t('Row below')} onClick={() => c().addRowAfter().run()} />
        <Btn large icon={<Columns2 size={22} />} label={t('Column left')} onClick={() => c().addColumnBefore().run()} />
        <Btn large icon={<Columns3 size={22} />} label={t('Column right')} onClick={() => c().addColumnAfter().run()} />
      </Group>
      <Group label={t('Delete')}>
        <div className="tw-stack">
          <Btn icon={<Trash2 size={14} />} label={t('Delete row')} onClick={() => c().deleteRow().run()} />
          <Btn icon={<Trash2 size={14} />} label={t('Delete column')} onClick={() => c().deleteColumn().run()} />
          <Btn icon={<Trash2 size={14} />} label={t('Delete table')} onClick={() => c().deleteTable().run()} />
        </div>
      </Group>
      <Group label={t('Merge')}>
        <Btn large icon={<Merge size={22} />} label={t('Merge')} onClick={() => c().mergeCells().run()} />
        <Btn large icon={<Split size={22} />} label={t('Split')} onClick={() => c().splitCell().run()} />
      </Group>
      <Group label={t('Options')}>
        <Btn large icon={<Type size={22} />} label={t('Header row')} title={t('First row as header row')} onClick={() => c().toggleHeaderRow().run()} />
      </Group>
    </>
  );
}
