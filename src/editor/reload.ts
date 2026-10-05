// Von außen geänderte Datei (z. B. durch Claude Code) sanft übernehmen: nur die
// geänderten Blöcke ersetzen, damit Cursor und Scrollposition bleiben und ⌘Z
// die Änderung zurücknehmen kann.

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Ersetzt die geänderten Blöcke; liefert den neuen Bereich (Dokumentpositionen) oder null. */
export function replaceChangedBlocks(editor: Editor, next: PMNode): { from: number; to: number } | null {
  const prev = editor.state.doc;
  let start = 0;
  const min = Math.min(prev.childCount, next.childCount);
  while (start < min && prev.child(start).eq(next.child(start))) start++;
  if (start === prev.childCount && start === next.childCount) return null;
  let endPrev = prev.childCount;
  let endNext = next.childCount;
  while (endPrev > start && endNext > start && prev.child(endPrev - 1).eq(next.child(endNext - 1))) {
    endPrev--;
    endNext--;
  }
  let from = 0;
  for (let i = 0; i < start; i++) from += prev.child(i).nodeSize;
  let to = from;
  for (let i = start; i < endPrev; i++) to += prev.child(i).nodeSize;
  const nodes: PMNode[] = [];
  for (let i = start; i < endNext; i++) nodes.push(next.child(i));
  const tr = editor.state.tr.replaceWith(from, to, nodes).setMeta('twLoad', true);
  editor.view.dispatch(tr);
  const size = nodes.reduce((n, node) => n + node.nodeSize, 0);
  return { from, to: from + size };
}

/** Zur Stelle scrollen, wenn sie gerade nicht sichtbar ist. */
export function revealRange(editor: Editor, from: number, scroller: HTMLElement | null) {
  if (!scroller) return;
  const dom = editor.view.nodeDOM(from);
  if (!(dom instanceof HTMLElement)) return;
  const box = dom.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (box.bottom > view.top + 40 && box.top < view.bottom - 40) return;
  scroller.scrollTo({ top: scroller.scrollTop + box.top - view.top - view.height / 3, behavior: 'smooth' });
}

/** Geänderte Blöcke kurz hervorheben. */
export function flashBlocks(editor: Editor, from: number, to: number) {
  const doms: HTMLElement[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) doms.push(dom);
    return false;
  });
  for (const d of doms) {
    d.classList.remove('tw-flash');
    void d.offsetWidth;
    d.classList.add('tw-flash');
    window.setTimeout(() => d.classList.remove('tw-flash'), 2600);
  }
}
