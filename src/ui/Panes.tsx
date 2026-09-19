// Title bar, status bar, preview, navigation, source view, find bar, problem list.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, CircleDashed, Loader2, X, CaseSensitive, WholeWord, Save, Undo2, Redo2 } from 'lucide-react';
import type { Diagnostic, MenuCommand, PreviewResult } from '../shared/api';
import { CodeEditor, revealLine, type CodeEditorHandle } from './CodeEditor';
import { findKey, gotoMatch, replaceAll, replaceCurrent, setFind } from '../editor/find';
import { contentText } from '../render/snippets';
import { getLang, t } from '../i18n';

// ------------------------------------------------------------------ Title bar

export function TitleBar({
  fileName,
  dirty,
  path,
  mainFile,
  autoSave,
  autoSaveByClaude,
  onAutoSave,
  editor,
  onCommand,
}: {
  fileName: string;
  dirty: boolean;
  path: string | null;
  mainFile: string | null;
  autoSave: boolean;
  autoSaveByClaude: boolean;
  onAutoSave: () => void;
  editor: Editor;
  onCommand: (c: MenuCommand) => void;
}) {
  const can = useEditorState({ editor, selector: ({ editor: e }) => ({ undo: e?.can().undo() ?? false, redo: e?.can().redo() ?? false }) });
  return (
    <div className="tw-titlebar">
      {/* Quick access like in Word: save, undo, redo */}
      <div className="tw-quick">
        <button title={t('Save (⌘S)')} onClick={() => onCommand('save')}>
          <Save size={15} />
        </button>
        <button title={t('Undo (⌘Z)')} disabled={!can?.undo} onClick={() => onCommand('undo')}>
          <Undo2 size={15} />
        </button>
        <button title={t('Redo (⇧⌘Z)')} disabled={!can?.redo} onClick={() => onCommand('redo')}>
          <Redo2 size={15} />
        </button>
      </div>
      <button
        className={`tw-autosave ${autoSave ? 'on' : ''}`}
        onClick={onAutoSave}
        title={autoSaveByClaude ? t('While the AI terminal is open, the editor saves automatically so the AI always sees your current text') : t('AutoSave')}
      >
        <span className="tw-autosave-label">{t('AutoSave')}</span>
        <span className="tw-switch">
          <i />
        </span>
        <span className="tw-autosave-state">{autoSave ? (autoSaveByClaude ? t('On (AI open)') : t('On')) : t('Off')}</span>
      </button>
      <div className="tw-titlebar-center">
        <span className="tw-titlebar-name">{fileName.replace(/\.typ$/, '')}</span>
        <span className="tw-titlebar-ext">.typ</span>
        <span className="tw-titlebar-state">{dirty ? `· ${t('Edited')}` : path ? `· ${t('Saved')}` : ''}</span>
        {mainFile && <span className="tw-titlebar-main">{t('Chapter of {file}', { file: mainFile.split('/').pop() ?? '' })}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Status bar

const LANG_NAMES: Record<string, string> = { de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano', nl: 'Nederlands' };

export function StatusBar(p: {
  page: number;
  pages: number;
  words: number;
  chars: number;
  lang: string | null;
  compiling: boolean;
  ms: number | null;
  snippetMs: number | null;
  errors: number;
  onErrors: () => void;
  zoom: number;
  onZoom: (z: number) => void;
  typstVersion: string | null;
  dirty: boolean;
}) {
  const locale = getLang() === 'de' ? 'de-DE' : 'en-US';
  return (
    <div className="tw-statusbar">
      <span>{p.pages ? t('Page {page} of {pages}', { page: p.page, pages: p.pages }) : t('No pages')}</span>
      <span>{t('{n} words', { n: p.words.toLocaleString(locale) })}</span>
      <span title={t('Characters without spaces')}>{t('{n} characters', { n: p.chars.toLocaleString(locale) })}</span>
      {p.lang && <span>{LANG_NAMES[p.lang] ?? p.lang}</span>}
      <button className={`tw-status-compile ${p.errors ? 'has-errors' : ''}`} onClick={p.onErrors} title={p.typstVersion ?? 'Typst'}>
        {p.compiling ? (
          <>
            <Loader2 size={12} className="spin" /> {t('Compiling …')}
          </>
        ) : p.errors ? (
          <>
            <AlertCircle size={12} /> {p.errors === 1 ? t('1 error') : t('{n} errors', { n: p.errors })}
          </>
        ) : p.ms !== null ? (
          <>
            <CheckCircle2 size={12} /> Typst {p.ms} ms
          </>
        ) : (
          <>
            <CircleDashed size={12} /> Typst
          </>
        )}
      </button>
      <div className="tw-status-spacer" />
      <div className="tw-zoom">
        <button onClick={() => p.onZoom(Math.max(0.4, Math.round((p.zoom - 0.1) * 10) / 10))}>−</button>
        <input type="range" min={40} max={250} step={5} value={Math.round(p.zoom * 100)} onChange={(e) => p.onZoom(Number(e.target.value) / 100)} />
        <button onClick={() => p.onZoom(Math.min(2.5, Math.round((p.zoom + 0.1) * 10) / 10))}>+</button>
        <span className="tw-zoom-val" onDoubleClick={() => p.onZoom(1)}>
          {Math.round(p.zoom * 100)} %
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Preview

/** Reading position in the editor: between heading `index` and the next one (fraction `frac`). */
export interface ScrollAnchor {
  index: number;
  frac: number;
  texts: string[];
  /** Fallback without headings: fraction of the whole document. */
  docFrac: number;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** At which output heading do the editor's headings start (not at 0 for chapters)? */
function alignHeadings(editor: string[], output: string[]): number {
  if (!editor.length) return 0;
  let best = 0;
  let bestScore = -1;
  for (let off = 0; off <= Math.max(0, output.length - 1); off++) {
    let score = 0;
    for (let i = 0; i < Math.min(editor.length, 6); i++) if (output[off + i] === editor[i]) score++;
    if (score > bestScore) {
      bestScore = score;
      best = off;
    }
    if (score === Math.min(editor.length, 6)) break;
  }
  return best;
}

export function PreviewPane({
  preview,
  compiling,
  zoom,
  onZoom,
  onClose,
  anchor,
  mainFile,
  onPage,
}: {
  preview: PreviewResult | null;
  compiling: boolean;
  zoom: number;
  onZoom: (z: number) => void;
  onClose: () => void;
  anchor: ScrollAnchor;
  mainFile: string | null;
  onPage: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  // Keep the pages of the last successful compile while there is an error
  const [pages, setPages] = useState(preview?.pages ?? []);
  const [heads, setHeads] = useState<{ text: string; page: number; y: number }[]>([]);
  useEffect(() => {
    if (!preview?.ok) return;
    setPages(preview.pages);
    setHeads((preview.headings ?? []).map((h) => ({ text: norm(contentText(h.body) ?? ''), page: h.page, y: h.y })));
  }, [preview]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pageEls = [...el.querySelectorAll<HTMLElement>('.tw-preview-page')];
    const posOf = (h: { page: number; y: number }) => {
      const pe = pageEls[h.page - 1];
      return pe ? pe.offsetTop + h.y * zoom * (4 / 3) : null;
    };
    const editorTexts = anchor.texts.map(norm);
    const off = alignHeadings(editorTexts, heads.map((h) => h.text));
    const at = (i: number) => (i >= 0 && heads[off + i] ? posOf(heads[off + i]) : null);
    let target: number | null = null;
    if (heads.length && editorTexts.length) {
      // Before the first heading: from the document start (for chapters: from the first heading)
      const a = anchor.index < 0 ? (off > 0 ? at(0) : 0) : at(anchor.index);
      const b = at(anchor.index + 1) ?? (anchor.index + 1 >= editorTexts.length ? (off + editorTexts.length < heads.length ? posOf(heads[off + editorTexts.length]) : el.scrollHeight) : null);
      if (a !== null && b !== null) target = a + anchor.frac * (b - a) - 60;
    }
    if (target === null) target = anchor.docFrac * (el.scrollHeight - el.clientHeight);
    if (follow) el.scrollTop = Math.max(0, target);
    // Page at the reading position, for the status bar
    const probe = Math.max(0, target) + 80;
    let page = 1;
    pageEls.forEach((pe, i) => {
      if (pe.offsetTop <= probe) page = i + 1;
    });
    onPage(pageEls.length ? page : 0);
  }, [anchor, follow, pages, heads, zoom, onPage]);
  const failed = preview && !preview.ok;
  return (
    <div className="tw-preview" style={{ width: `${Math.round(595 * zoom * 1.333 + 48)}px` }}>
      <div className="tw-pane-head">
        <span>{t('Print Preview')}</span>
        {mainFile && <span className="tw-pane-sub">{t('via {file}', { file: mainFile.split('/').pop() ?? '' })}</span>}
        {compiling && <Loader2 size={12} className="spin" />}
        <div className="tw-pane-spacer" />
        <label className="tw-follow" title={t('Scroll the preview along with the editor')}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {t('follow')}
        </label>
        <select className="tw-select tw-select-small" value={String(zoom)} onChange={(e) => onZoom(Number(e.target.value))}>
          {[0.35, 0.5, 0.65, 0.8, 1].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)} %
            </option>
          ))}
        </select>
        <button className="tw-pane-close" onClick={onClose} title={t('Hide preview')}>
          <X size={14} />
        </button>
      </div>
      {failed && (
        <div className="tw-preview-error">
          <AlertCircle size={14} />
          <div>
            {preview.diagnostics
              .filter((d) => d.severity === 'error')
              .slice(0, 3)
              .map((d, i) => (
                <div key={i}>
                  <b>{d.line ? `${t('Line {n}', { n: d.line })}: ` : ''}</b>
                  {d.message}
                </div>
              ))}
          </div>
        </div>
      )}
      <div className="tw-preview-scroll" ref={ref}>
        {pages.map((p, i) => (
          <div key={i} className="tw-preview-page" style={{ width: `${p.width * zoom}pt`, height: `${p.height * zoom}pt` }}>
            <img src={p.url} alt={t('Page {page}', { page: i + 1 })} draggable={false} />
            <span className="tw-preview-num">{i + 1}</span>
          </div>
        ))}
        {!pages.length && !failed && <div className="tw-preview-empty">{compiling ? t('Compiling …') : t('No preview yet')}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Navigation

export function NavPane({ editor, numbering, scrollEl }: { editor: Editor; numbering: string | null; scrollEl: RefObject<HTMLDivElement | null> }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: { level: number; text: string; pos: number }[] = [];
      e?.state.doc.descendants((n, pos) => {
        if (n.type.name === 'heading') {
          out.push({ level: n.attrs.level, text: n.textContent, pos });
          return false;
        }
        return true;
      });
      return out;
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const nums = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0];
    return (headings ?? []).map((h) => {
      c[h.level - 1]++;
      for (let i = h.level; i < 6; i++) c[i] = 0;
      return c.slice(0, h.level).join('.');
    });
  }, [headings]);
  const go = (pos: number) => {
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (dom && scrollEl.current) {
      const top = dom.getBoundingClientRect().top - scrollEl.current.getBoundingClientRect().top + scrollEl.current.scrollTop - 24;
      scrollEl.current.scrollTo({ top, behavior: 'smooth' });
    }
    editor.chain().setTextSelection(pos + 1).focus(undefined, { scrollIntoView: false }).run();
  };
  return (
    <div className="tw-nav">
      <div className="tw-pane-head">
        <span>{t('Navigation')}</span>
      </div>
      <div className="tw-nav-list">
        {(headings ?? []).length === 0 && <div className="tw-nav-empty">{t('Headings appear here. Apply the “Heading 1” style to a paragraph.')}</div>}
        {(headings ?? []).map((h, i) => (
          <button key={i} className={`tw-nav-item level-${h.level}`} onClick={() => go(h.pos)} title={h.text}>
            {numbering && <span className="tw-nav-num">{nums[i]}</span>}
            {h.text || <em>{t('(empty)')}</em>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Source

export function SourcePane({
  text,
  onChange,
  onFocus,
  onClose,
  diagnostics,
  path,
}: {
  text: string;
  onChange: (t: string) => void;
  onFocus: (focused: boolean) => void;
  onClose: () => void;
  diagnostics: Diagnostic[];
  path: string | null;
}) {
  const handle = useRef<CodeEditorHandle>({ view: null });
  const own = diagnostics.filter((d) => d.severity === 'error' && (!path || d.file === path));
  return (
    <div className="tw-source" onFocusCapture={() => onFocus(true)} onBlurCapture={() => onFocus(false)}>
      <div className="tw-pane-head">
        <span>{t('Typst Source')}</span>
        <span className="tw-pane-sub">{t('Changes here are applied to the editor right away')}</span>
        <div className="tw-pane-spacer" />
        <button className="tw-pane-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {own.length > 0 && (
        <div className="tw-source-errors">
          {own.slice(0, 4).map((d, i) => (
            <button key={i} onClick={() => revealLine(handle.current.view, d.line)}>
              <AlertCircle size={12} /> {t('Line {n}', { n: d.line })}: {d.message}
            </button>
          ))}
        </div>
      )}
      <CodeEditor value={text} onChange={onChange} handle={handle.current} className="tw-source-editor" />
    </div>
  );
}

// ------------------------------------------------------------------ Find & replace

export function FindBar({ editor, mode, onClose, onMode }: { editor: Editor; mode: 'find' | 'replace'; onClose: () => void; onMode: (m: 'find' | 'replace') => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to, empty } = editor.state.selection;
    return empty ? '' : editor.state.doc.textBetween(from, to, ' ').slice(0, 80);
  });
  const [replacement, setReplacement] = useState('');
  const [cs, setCs] = useState(false);
  const [ww, setWw] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const st = useEditorState({ editor, selector: ({ editor: e }) => (e ? findKey.getState(e.state) : null) });
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [mode]);
  useEffect(() => {
    setFind(editor.view, { query, caseSensitive: cs, wholeWord: ww, current: 0 });
  }, [query, cs, ww, editor]);
  useEffect(() => () => setFind(editor.view, { query: '' }), [editor]);
  const count = st?.matches.length ?? 0;
  return (
    <div className="tw-findbar" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="tw-find-row">
        <input
          ref={input}
          className="tw-input"
          placeholder={t('Find')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') gotoMatch(editor.view, e.shiftKey ? -1 : 1);
          }}
        />
        <span className="tw-find-count">{query ? (count ? t('{i} of {n}', { i: (st?.current ?? 0) + 1, n: count }) : t('No results')) : ''}</span>
        <button title={t('Match case')} className={cs ? 'on' : ''} onClick={() => setCs(!cs)}>
          <CaseSensitive size={15} />
        </button>
        <button title={t('Whole words only')} className={ww ? 'on' : ''} onClick={() => setWw(!ww)}>
          <WholeWord size={15} />
        </button>
        <button title={t('Previous (⇧↩)')} onClick={() => gotoMatch(editor.view, -1)}>
          <ChevronUp size={15} />
        </button>
        <button title={t('Next (↩)')} onClick={() => gotoMatch(editor.view, 1)}>
          <ChevronDown size={15} />
        </button>
        <button title={t('Show or hide replace')} onClick={() => onMode(mode === 'find' ? 'replace' : 'find')}>
          ⇄
        </button>
        <button title={t('Close (Esc)')} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {mode === 'replace' && (
        <div className="tw-find-row">
          <input
            className="tw-input"
            placeholder={t('Replace with')}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') replaceCurrent(editor.view, replacement);
            }}
          />
          <button className="tw-text-btn" onClick={() => replaceCurrent(editor.view, replacement)}>
            {t('Replace')}
          </button>
          <button className="tw-text-btn" onClick={() => replaceAll(editor.view, replacement)}>
            {t('Replace all')}
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Problems

export function Problems({ diagnostics, onClose, onShowSource }: { diagnostics: Diagnostic[]; onClose: () => void; onShowSource: () => void }) {
  return (
    <div className="tw-problems">
      <div className="tw-pane-head">
        <span>{t('Problems while compiling')}</span>
        <div className="tw-pane-spacer" />
        <button className="tw-text-btn" onClick={onShowSource}>
          {t('Show source')}
        </button>
        <button className="tw-pane-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="tw-problems-list">
        {diagnostics.map((d, i) => (
          <div key={i} className={`tw-problem ${d.severity}`}>
            <AlertCircle size={13} />
            <div>
              <div>
                <b>{d.file ? `${d.file.split('/').pop()}${d.line ? `:${d.line}` : ''}` : ''}</b> {d.message}
              </div>
              {d.hints.map((h, j) => (
                <div key={j} className="tw-problem-hint">
                  {t('Hint')}: {h}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
