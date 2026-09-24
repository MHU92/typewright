// CodeMirror-Editor mit einfacher Typst-Hervorhebung (für Quelltext und Code-Dialoge).

import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

interface TypstState {
  /** Klammer-Stapel: `[` = Markup, `(`/`{` = Code. */
  stack: string[];
  math: boolean;
  /** Direkt nach `#`: ein Ausdruck folgt. */
  afterHash: boolean;
  blockComment: boolean;
}

const typstLanguage = StreamLanguage.define<TypstState>({
  name: 'typst',
  startState: () => ({ stack: [], math: false, afterHash: false, blockComment: false }),
  copyState: (s) => ({ stack: [...s.stack], math: s.math, afterHash: s.afterHash, blockComment: s.blockComment }),
  token(stream, state) {
    if (state.blockComment) {
      if (stream.match(/.*?\*\//)) state.blockComment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    // `https://…` ist ein Link, kein Kommentar
    if (stream.match(/^https?:\/\/[^\s\])>"]+/)) return 'link';
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.blockComment = true;
      return 'comment';
    }
    const top = state.stack[state.stack.length - 1];
    const inCode = top === '(' || top === '{' || state.afterHash;
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
      state.afterHash = false;
      return 'string';
    }
    if (state.math) {
      if (stream.eat('$')) {
        state.math = false;
        return 'keyword';
      }
      stream.next();
      return 'variableName.special';
    }
    if (inCode) {
      if (stream.match(/^(let|set|show|import|include|if|else|for|in|while|return|context|none|auto|true|false|and|or|not|break|continue)\b/)) {
        state.afterHash = false;
        return 'keyword';
      }
      if (stream.match(/^[\d.]+(pt|mm|cm|in|em|fr|%|deg|rad)?/)) {
        state.afterHash = false;
        return 'number';
      }
      if (stream.match(/^[a-zA-Z_][\w-]*(?=\s*[([])/)) {
        return 'function';
      }
      if (stream.match(/^[a-zA-Z_][\w-]*/)) {
        if (!stream.match(/^\./, false)) state.afterHash = false;
        return 'variableName';
      }
    }
    const ch = stream.next()!;
    if (ch === '#') {
      state.afterHash = true;
      return 'keyword';
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      state.stack.push(ch);
      state.afterHash = false;
      return 'bracket';
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      state.stack.pop();
      state.afterHash = /[)\]]/.test(ch) && stream.match(/^[[(.]/, false) ? true : false;
      return 'bracket';
    }
    if (inCode) {
      state.afterHash = state.afterHash && /[.]/.test(ch);
      return null;
    }
    state.afterHash = false;
    if (ch === '$') {
      state.math = true;
      return 'keyword';
    }
    if (ch === '=' && stream.column() === 0) {
      stream.skipToEnd();
      return 'heading';
    }
    if (ch === '*') return 'strong';
    if (ch === '_') return 'emphasis';
    if (ch === '`') {
      stream.match(/^[^`]*`/);
      return 'monospace';
    }
    if (ch === '<' && stream.match(/^[\w:.-]+>/)) return 'labelName';
    if (ch === '@' && stream.match(/^[\w:.-]+/)) return 'labelName';
    if (ch === '\\') {
      stream.next();
      return 'escape';
    }
    if ((ch === '-' || ch === '+') && stream.column() <= 12 && /^\s*$/.test(stream.string.slice(0, stream.column()))) return 'list';
    return null;
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
});

const highlight = HighlightStyle.define([
  { tag: t.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: t.keyword, color: '#b3127d' },
  { tag: t.string, color: '#0a7a3e' },
  { tag: t.number, color: '#a85d00' },
  { tag: t.function(t.variableName), color: '#1d4fd8' },
  { tag: t.variableName, color: '#1f2937' },
  { tag: t.special(t.variableName), color: '#7c3aed' },
  { tag: t.heading, color: '#0f3d91', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.monospace, color: '#7a3e00' },
  { tag: t.labelName, color: '#0e7490' },
  { tag: t.escape, color: '#a85d00' },
  { tag: t.list, color: '#b3127d', fontWeight: '700' },
  { tag: t.bracket, color: '#6b7280' },
  { tag: t.link, color: '#1d4fd8', textDecoration: 'underline' },
]);

const baseTheme = EditorView.theme({
  '&': { fontSize: '12.5px', height: '100%', backgroundColor: '#fff' },
  '.cm-content': { fontFamily: '"SF Mono", Menlo, Monaco, monospace', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: '#f7f7f8', color: '#9aa0a6', border: 'none', borderRight: '1px solid #ececec' },
  '.cm-activeLine': { backgroundColor: '#f3f6fc' },
  '.cm-activeLineGutter': { backgroundColor: '#e8eefb' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#cfe0fb !important' },
});

export interface CodeEditorHandle {
  view: EditorView | null;
}

export interface CodeEditorProps {
  value: string;
  onChange?: (v: string) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  lineNumbers?: boolean;
  className?: string;
  handle?: CodeEditorHandle;
  readOnly?: boolean;
}

export function CodeEditor({ value, onChange, onSubmit, autoFocus, lineNumbers: showNumbers = true, className, handle, readOnly }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef({ onChange, onSubmit });
  cbs.current = { onChange, onSubmit };
  /** Übernahme eines Werts von außen: kein onChange auslösen (sonst gilt das Dokument als geändert). */
  const syncing = useRef(false);

  useEffect(() => {
    const exts: Extension[] = [
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      typstLanguage,
      syntaxHighlighting(highlight),
      baseTheme,
      EditorView.lineWrapping,
      keymap.of([
        { key: 'Mod-Enter', run: () => (cbs.current.onSubmit?.(), true) },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !syncing.current) cbs.current.onChange?.(u.state.doc.toString());
      }),
      EditorState.readOnly.of(!!readOnly),
    ];
    if (showNumbers) exts.push(lineNumbers(), highlightActiveLineGutter());
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions: exts }), parent: host.current! });
    view.current = v;
    if (handle) handle.view = v;
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
      if (handle) handle.view = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Von außen geänderten Wert übernehmen, ohne die Cursorposition unnötig zu verlieren
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    let start = 0;
    while (start < current.length && start < value.length && current[start] === value[start]) start++;
    let endA = current.length;
    let endB = value.length;
    while (endA > start && endB > start && current[endA - 1] === value[endB - 1]) {
      endA--;
      endB--;
    }
    syncing.current = true;
    try {
      v.dispatch({ changes: { from: start, to: endA, insert: value.slice(start, endB) } });
    } finally {
      syncing.current = false;
    }
  }, [value]);

  return <div ref={host} className={className ?? 'tw-code-editor'} />;
}

/** Zur Zeile springen und markieren. */
export function revealLine(v: EditorView | null, line: number) {
  if (!v) return;
  const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
  v.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
  v.focus();
}
