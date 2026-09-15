// How the Typst-specific nodes look in the editor.

import { useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { NodeViewContent, NodeViewWrapper, useEditorState, type ReactNodeViewProps } from '@tiptap/react';
import { ChevronDown, ChevronRight, Code2, ExternalLink, FileText, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useGeometry, useRender } from '../render/snippets';
import { assetUrl, editCode, getDocContext, subscribeDocContext } from './context';
import { typstColorToCss } from '../typst/values';
import { t } from '../i18n';
import { useLang } from '../ui/useLang';

function useDocContext() {
  return useSyncExternalStore(subscribeDocContext, getDocContext);
}

const lineCount = (s: string) => s.split('\n').length;

function firstLine(src: string, max = 90) {
  const line = src.split('\n')[0];
  return line.length > max ? line.slice(0, max) + ' …' : line;
}

function stop(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

// ------------------------------------------------------------------ Typst block

export function TypstBlockView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  useLang();
  const src = String(node.attrs.src ?? '');
  const kind = String(node.attrs.kind ?? 'expr');
  const edit = (e?: MouseEvent) => {
    if (e) stop(e);
    editCode({
      title: kind === 'code' ? t('Template (Typst code)') : kind === 'comment' ? t('Comment') : t('Edit Typst code'),
      hint:
        kind === 'code'
          ? t('Settings such as fonts, margins and your own functions. They apply to the whole document.')
          : kind === 'comment'
            ? t('Comments do not appear in the PDF.')
            : t('This part is Typst code. It is shown exactly as it appears in the PDF.'),
      code: src,
      onSave: (code) => updateAttributes({ src: code }),
      onDelete: deleteNode,
    });
  };
  if (kind === 'code') return <CodeRegion src={src} selected={selected} onEdit={edit} />;
  if (kind === 'comment') return <CommentNote src={src} selected={selected} onEdit={edit} />;
  if (kind === 'include') return <IncludeCard src={src} selected={selected} onEdit={edit} />;
  return <RenderedBlock kind="block" src={src} selected={selected} onEdit={edit} onDelete={deleteNode} label="Typst" />;
}

function RenderedBlock({
  kind,
  src,
  selected,
  onEdit,
  onDelete,
  label,
}: {
  kind: 'block' | 'math';
  src: string;
  selected: boolean;
  onEdit: (e?: MouseEvent) => void;
  onDelete: () => void;
  label: string;
}) {
  const r = useRender(kind, src);
  const geo = useGeometry();
  const ctx = useDocContext();
  let body;
  if (r?.status === 'ok' && r.url && !r.empty) {
    const style: CSSProperties = geo
      ? { width: `${r.width}pt`, marginLeft: `${-geo.marginLeft}pt`, maxWidth: 'none' }
      : { width: '100%' };
    body = <img className="tw-snippet-img" src={r.url} style={style} draggable={false} alt="" />;
  } else if (r?.status === 'ok' && r.empty) {
    body = (
      <div className="tw-code-pill" title={src}>
        <Code2 size={12} /> {firstLine(src)}
      </div>
    );
  } else if (r?.status === 'error') {
    body = (
      <div className="tw-code-error">
        <pre>{src}</pre>
        <div className="tw-code-error-msg">{r.error}</div>
      </div>
    );
  } else {
    body = <pre className="tw-code-pending">{src}</pre>;
  }
  return (
    <NodeViewWrapper
      className={`tw-rendered ${selected ? 'is-selected' : ''} ${ctx.showMarks ? 'show-marks' : ''}`}
      data-drag-handle
      onDoubleClick={onEdit}
    >
      <div className="tw-rendered-tag" contentEditable={false}>
        {label}
      </div>
      {body}
      <div className="tw-block-tools" contentEditable={false}>
        <button onMouseDown={stop} onClick={onEdit} title={t('Edit code')}>
          <Pencil size={13} /> {t('Edit')}
        </button>
        <button
          onMouseDown={stop}
          onClick={(e) => {
            stop(e);
            onDelete();
          }}
          title={t('Remove')}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

function CodeRegion({ src, selected, onEdit }: { src: string; selected: boolean; onEdit: (e?: MouseEvent) => void }) {
  const [open, setOpen] = useState(false);
  const lines = lineCount(src);
  const ctx = useDocContext();
  const short = lines <= 2 && src.length < 120;
  if (short && !ctx.showMarks) {
    return (
      <NodeViewWrapper className={`tw-code-line ${selected ? 'is-selected' : ''}`} data-drag-handle onDoubleClick={onEdit}>
        <span className="tw-code-line-text">{src}</span>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className={`tw-code-region ${selected ? 'is-selected' : ''} ${open ? 'is-open' : ''}`} data-drag-handle>
      <div className="tw-code-region-head" contentEditable={false} onMouseDown={stop} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Code2 size={14} />
        <span className="tw-code-region-title">{t('Template')}</span>
        <span className="tw-code-region-meta">
          {t('{n} lines of Typst code', { n: lines })} · {summarize(src)}
        </span>
        <button
          className="tw-code-region-edit"
          onMouseDown={stop}
          onClick={(e) => {
            stop(e);
            onEdit();
          }}
        >
          <Pencil size={12} /> {t('Edit')}
        </button>
      </div>
      {open && (
        <pre className="tw-code-region-body" onDoubleClick={onEdit}>
          {src}
        </pre>
      )}
    </NodeViewWrapper>
  );
}

function summarize(src: string): string {
  const parts: string[] = [];
  const count = (re: RegExp) => (src.match(re) ?? []).length;
  const imports = count(/^#import/gm);
  const sets = count(/^#set /gm);
  const shows = count(/^#show/gm);
  const lets = count(/^#let /gm);
  if (imports) parts.push(imports === 1 ? t('1 import') : t('{n} imports', { n: imports }));
  if (sets) parts.push(sets === 1 ? t('1 setting') : t('{n} settings', { n: sets }));
  if (shows) parts.push(shows === 1 ? t('1 style rule') : t('{n} style rules', { n: shows }));
  if (lets) parts.push(lets === 1 ? t('1 definition') : t('{n} definitions', { n: lets }));
  return parts.join(', ') || t('comments');
}

function CommentNote({ src, selected, onEdit }: { src: string; selected: boolean; onEdit: (e?: MouseEvent) => void }) {
  const text = src
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/\s?/, '').replace(/^\s*\/\*\s?|\s?\*\/\s*$/g, ''))
    .join('\n')
    .trim();
  return (
    <NodeViewWrapper className={`tw-comment ${selected ? 'is-selected' : ''}`} data-drag-handle onDoubleClick={onEdit}>
      <MessageSquare size={13} className="tw-comment-icon" />
      <div className="tw-comment-text">{text}</div>
    </NodeViewWrapper>
  );
}

function IncludeCard({ src, selected, onEdit }: { src: string; selected: boolean; onEdit: (e?: MouseEvent) => void }) {
  const ctx = useDocContext();
  const m = src.match(/include\s*\(?\s*"([^"]+)"/);
  const rel = m?.[1] ?? null;
  const open = (e: MouseEvent) => {
    stop(e);
    if (!rel || !ctx.dir) return;
    const abs = rel.startsWith('/') ? `${ctx.root ?? ctx.dir}${rel}` : `${ctx.dir}/${rel}`;
    void window.tw.openPath(abs);
  };
  return (
    <NodeViewWrapper className={`tw-include ${selected ? 'is-selected' : ''}`} data-drag-handle onDoubleClick={onEdit}>
      <FileText size={16} />
      <span className="tw-include-label">{t('Included:')}</span>
      <span className="tw-include-path">{rel ?? src}</span>
      {rel && (
        <button onMouseDown={stop} onClick={open}>
          <ExternalLink size={12} /> {t('Open')}
        </button>
      )}
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Equations

export function MathBlockView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  useLang();
  const src = String(node.attrs.src ?? '');
  const edit = (e?: MouseEvent) => {
    if (e) stop(e);
    editCode({
      title: t('Edit equation'),
      hint: t('Typst math, e.g. sum_(i=1)^n i or a^2 + b^2 = c^2. Display equations need spaces inside the $ signs.'),
      code: src,
      language: 'math',
      onSave: (code) => updateAttributes({ src: code }),
      onDelete: deleteNode,
    });
  };
  return <RenderedBlock kind="math" src={src} selected={selected} onEdit={edit} onDelete={deleteNode} label={t('Equation')} />;
}

export function MathInlineView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const src = String(node.attrs.src ?? '');
  const r = useRender('math-inline', src);
  const edit = (e?: MouseEvent) => {
    if (e) stop(e);
    editCode({
      title: t('Edit equation'),
      code: src,
      language: 'math',
      onSave: (code) => updateAttributes({ src: code }),
      onDelete: deleteNode,
    });
  };
  return (
    <NodeViewWrapper as="span" className={`tw-math-inline ${selected ? 'is-selected' : ''}`} onDoubleClick={edit} title={src}>
      {r?.status === 'ok' && r.url && !r.empty ? (
        <img src={r.url} style={{ height: `${r.height}pt` }} draggable={false} alt={src} />
      ) : (
        <span className={r?.status === 'error' ? 'tw-inline-code is-error' : 'tw-inline-code'}>{src}</span>
      )}
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Inline code

export function TypstInlineView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const src = String(node.attrs.src ?? '');
  const kind = String(node.attrs.kind ?? 'expr');
  const r = useRender('inline', src);
  const ctx = useDocContext();
  const edit = (e?: MouseEvent) => {
    if (e) stop(e);
    editCode({
      title: kind === 'ref' ? t('Cross-reference') : kind === 'comment' ? t('Comment') : t('Typst expression'),
      code: src,
      onSave: (code) => updateAttributes({ src: code }),
      onDelete: deleteNode,
    });
  };
  const cls = `tw-inline ${selected ? 'is-selected' : ''}`;
  if (kind === 'ref') {
    const name = src.replace(/^@/, '').replace(/\[.*$/s, '');
    return (
      <NodeViewWrapper as="span" className={`${cls} tw-ref`} onDoubleClick={edit} title={t('Reference to <{name}>', { name })}>
        {name}
      </NodeViewWrapper>
    );
  }
  if (kind === 'label') {
    return (
      <NodeViewWrapper as="span" className={`${cls} tw-label ${ctx.showMarks ? 'show' : ''}`} onDoubleClick={edit} title={t('Label')}>
        {src}
      </NodeViewWrapper>
    );
  }
  if (kind === 'comment') {
    return (
      <NodeViewWrapper as="span" className={`${cls} tw-inline-comment`} onDoubleClick={edit} title={src}>
        <MessageSquare size={11} />
      </NodeViewWrapper>
    );
  }
  if (r?.status === 'ok' && r.text && r.text.trim()) {
    return (
      <NodeViewWrapper
        as="span"
        className={`${cls} tw-eval`}
        style={r.fill ? { background: r.fill, borderRadius: 2 } : undefined}
        onDoubleClick={edit}
        title={src}
      >
        {r.text}
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper as="span" className={`${cls} tw-inline-code ${r?.status === 'error' ? 'is-error' : ''}`} onDoubleClick={edit} title={r?.error ?? src}>
      {src.length > 60 ? src.slice(0, 57) + '…' : src}
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Custom function with content

export function CallBlockView({ node, selected, updateAttributes }: ReactNodeViewProps) {
  const ctx = useDocContext();
  const callee = String(node.attrs.callee);
  const args = (node.attrs.args as string | null) ?? '';
  const style: CSSProperties = {};
  const align = callee === 'align' ? args.match(/\b(center|right|left)\b/)?.[1] : null;
  if (align) style.textAlign = align as CSSProperties['textAlign'];
  const fill = args.match(/fill:\s*([^,)]+(?:\([^)]*\))?)/)?.[1];
  const css = fill ? typstColorToCss(fill.trim()) : null;
  if (callee === 'text') {
    // A block-level `#text(size: 22pt, weight: "bold")[...]`: mimic its look in the editor
    if (css) style.color = css;
    const size = args.match(/size:\s*([\d.]+)pt/)?.[1];
    if (size) style.fontSize = `${size}pt`;
    const weight = args.match(/weight:\s*"?(\w+)"?/)?.[1];
    const weights: Record<string, number> = { bold: 700, semibold: 600, medium: 500, regular: 400, light: 300 };
    if (weight) style.fontWeight = weights[weight] ?? Number(weight);
    const font = args.match(/font:\s*"([^"]+)"/)?.[1];
    if (font) style.fontFamily = `"${font}"`;
  } else if (css) style.background = css;
  const edit = (e: MouseEvent) => {
    stop(e);
    editCode({
      title: t('#{callee}(…) – arguments', { callee }),
      hint: t('Only the arguments in parentheses; the content stays in the editor.'),
      code: args,
      onSave: (code) => {
        const c = code.trim();
        updateAttributes({ args: c ? (c.startsWith('(') ? c : `(${c})`) : null });
      },
    });
  };
  return (
    <NodeViewWrapper className={`tw-call tw-call-${callee} ${selected ? 'is-selected' : ''} ${ctx.showMarks ? 'show-marks' : ''}`} style={style}>
      <div className="tw-call-tag" contentEditable={false} onMouseDown={stop} onClick={edit} title={`#${callee}${args}[…]`}>
        {callee}
      </div>
      <NodeViewContent className="tw-call-content" />
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Image

export function ImageView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  useDocContext();
  const src = String(node.attrs.src ?? '');
  const url = assetUrl(src);
  const width = (node.attrs.width as string | null) ?? null;
  const cssWidth = width && /^[\d.]+(%|pt|mm|cm|in|em)$/.test(width) ? width : width ? undefined : 'auto';
  const sizes = ['25%', '50%', '75%', '100%'];
  return (
    <NodeViewWrapper className={`tw-image-wrap ${selected ? 'is-selected' : ''}`} data-drag-handle>
      {url ? <img src={url} style={{ width: cssWidth, maxWidth: '100%' }} draggable={false} alt={src} /> : <div className="tw-image-missing">{src}</div>}
      {selected && (
        <div className="tw-image-tools" contentEditable={false}>
          {sizes.map((s) => (
            <button key={s} className={width === s ? 'on' : ''} onMouseDown={stop} onClick={() => updateAttributes({ width: s })}>
              {s}
            </button>
          ))}
          <button className={!width ? 'on' : ''} onMouseDown={stop} onClick={() => updateAttributes({ width: null })}>
            {t('Original')}
          </button>
          <button onMouseDown={stop} onClick={() => deleteNode()} title={t('Remove')}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Table of contents & page break

export function TocView({ editor, selected }: ReactNodeViewProps) {
  useLang();
  const geo = useGeometry();
  // Re-read on every change so the table of contents stays live
  const all =
    useEditorState({
      editor,
      selector: ({ editor: e }) => {
        const out: { level: number; text: string }[] = [];
        e?.state.doc.descendants((n) => {
          if (n.type.name === 'heading') {
            out.push({ level: n.attrs.level as number, text: n.textContent });
            return false;
          }
          return true;
        });
        return out;
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    }) ?? [];
  const headings: { level: number; text: string; num: string }[] = [];
  const counters = [0, 0, 0, 0, 0, 0];
  for (const h of all) {
    counters[h.level - 1]++;
    for (let i = h.level; i < 6; i++) counters[i] = 0;
    const num = geo?.headingNumbering ? counters.slice(0, h.level).join('.') : '';
    if (h.level <= 3) headings.push({ ...h, num });
  }
  // Typst titles the outline in the document language
  const title = geo?.lang === 'de' ? 'Inhaltsverzeichnis' : 'Contents';
  return (
    <NodeViewWrapper className={`tw-toc ${selected ? 'is-selected' : ''}`} data-drag-handle>
      <div className="tw-toc-title">{title}</div>
      {headings.length === 0 && <div className="tw-toc-empty">{t('No headings yet')}</div>}
      {headings.map((h, i) => (
        <div key={i} className={`tw-toc-entry level-${h.level}`}>
          {h.num && <span className="tw-toc-num">{h.num}</span>}
          <span className="tw-toc-text">{h.text}</span>
          <span className="tw-toc-dots" />
        </div>
      ))}
    </NodeViewWrapper>
  );
}

export function PageBreakView({ selected }: ReactNodeViewProps) {
  useLang();
  return (
    <NodeViewWrapper className={`tw-page-break ${selected ? 'is-selected' : ''}`} data-drag-handle>
      <span>{t('Page break')}</span>
    </NodeViewWrapper>
  );
}
