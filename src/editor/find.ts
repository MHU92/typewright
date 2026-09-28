// Suchen & Ersetzen als ProseMirror-Plugin (Treffer als Dekorationen).

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface FindState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  matches: { from: number; to: number }[];
  current: number;
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>('twFind');

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function search(doc: PMNode, query: string, caseSensitive: boolean, wholeWord: boolean) {
  const matches: { from: number; to: number }[] = [];
  if (!query) return matches;
  const re = new RegExp(wholeWord ? `\\b${escapeRe(query)}\\b` : escapeRe(query), caseSensitive ? 'gu' : 'giu');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text des Absatzes mit Positionszuordnung (Inline-Atome zählen als ein Zeichen)
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) {
          text += child.text![i];
          map.push(pos + 1 + offset + i);
        }
      } else {
        text += '￼';
        map.push(pos + 1 + offset);
      }
    });
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      matches.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1 });
    }
    return false;
  });
  return matches;
}

function build(doc: PMNode, query: string, caseSensitive: boolean, wholeWord: boolean, current: number): FindState {
  const matches = search(doc, query, caseSensitive, wholeWord);
  const cur = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1;
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === cur ? 'tw-find-hit is-current' : 'tw-find-hit' })),
  );
  return { query, caseSensitive, wholeWord, matches, current: cur, decorations };
}

const empty = (): FindState => ({ query: '', caseSensitive: false, wholeWord: false, matches: [], current: -1, decorations: DecorationSet.empty });

export const FindExtension = Extension.create({
  name: 'twFind',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: empty,
          apply(tr: Transaction, prev: FindState) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (meta) {
              const q = meta.query ?? prev.query;
              return build(tr.doc, q, meta.caseSensitive ?? prev.caseSensitive, meta.wholeWord ?? prev.wholeWord, meta.current ?? 0);
            }
            if (tr.docChanged && prev.query) return build(tr.doc, prev.query, prev.caseSensitive, prev.wholeWord, prev.current);
            return prev;
          },
        },
        props: {
          decorations(state: EditorState) {
            return findKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

type View = { state: EditorState; dispatch: (tr: Transaction) => void };

export function setFind(view: View, patch: Partial<Pick<FindState, 'query' | 'caseSensitive' | 'wholeWord' | 'current'>>) {
  view.dispatch(view.state.tr.setMeta(findKey, patch));
}

export function gotoMatch(view: View & { dom: HTMLElement }, delta: number) {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return;
  const next = (st.current + delta + st.matches.length) % st.matches.length;
  const m = st.matches[next];
  const tr = view.state.tr.setMeta(findKey, { current: next }).setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView();
  view.dispatch(tr);
}

export function replaceCurrent(view: View, replacement: string) {
  const st = findKey.getState(view.state);
  if (!st || st.current < 0) return;
  const m = st.matches[st.current];
  const marks = view.state.doc.resolve(m.from).marks();
  const tr = view.state.tr;
  if (replacement) tr.replaceWith(m.from, m.to, view.state.schema.text(replacement, marks));
  else tr.delete(m.from, m.to);
  tr.setMeta(findKey, { current: st.current });
  view.dispatch(tr);
}

export function replaceAll(view: View, replacement: string): number {
  const st = findKey.getState(view.state);
  if (!st || !st.matches.length) return 0;
  const tr = view.state.tr;
  for (const m of [...st.matches].reverse()) {
    const marks = view.state.doc.resolve(m.from).marks();
    if (replacement) tr.replaceWith(m.from, m.to, view.state.schema.text(replacement, marks));
    else tr.delete(m.from, m.to);
  }
  tr.setMeta(findKey, { current: 0 });
  view.dispatch(tr);
  return st.matches.length;
}
