// Dokumentweite Einstellungen (Seite, Schrift, Absatz, Überschriften) als
// `#set`-Regeln in der Vorlage des Dokuments lesen und ändern.

import type { Editor } from '@tiptap/core';
import { hydrate, type Cst, type RawCst } from './cst';

export type SetFunc = 'page' | 'text' | 'par' | 'heading' | 'document';

interface Found {
  pos: number;
  src: string;
  /** Bereich der Args-Klammern im src. */
  argsStart: number;
  argsEnd: number;
  args: Cst;
}

/** Typst-Code der Vorlage-Blöcke vor dem ersten Inhalt. */
function codeBlocks(editor: Editor): { pos: number; src: string }[] {
  const out: { pos: number; src: string }[] = [];
  let seenContent = false;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'typstBlock' && node.attrs.kind === 'code') {
      if (!seenContent || /#set\s/.test(node.attrs.src)) out.push({ pos: offset, src: node.attrs.src });
    } else if (node.type.name !== 'typstBlock' || node.attrs.kind !== 'comment') {
      if (node.textContent.trim() || node.type.name !== 'paragraph') seenContent = true;
    }
  });
  return out;
}

async function findSetRule(editor: Editor, func: SetFunc): Promise<Found | null> {
  let found: Found | null = null;
  for (const block of codeBlocks(editor)) {
    const tree = hydrate((await window.tw.parse(block.src)) as RawCst);
    const visit = (n: Cst) => {
      if (n.kind === 'SetRule') {
        const target = n.children.find((c) => c.kind === 'Ident' || c.kind === 'FieldAccess');
        const args = n.children.find((c) => c.kind === 'Args');
        const hasCondition = n.children.some((c) => c.kind === 'If');
        if (target && args && !hasCondition && block.src.slice(target.start, target.end) === func) {
          found = { pos: block.pos, src: block.src, argsStart: args.start, argsEnd: args.end, args };
        }
        return;
      }
      if (n.kind === 'ContentBlock' || n.kind === 'CodeBlock' || n.kind === 'Closure') return;
      n.children.forEach(visit);
    };
    visit(tree);
  }
  return found;
}

/** Wert eines benannten Arguments der wirksamen `#set func(...)`-Regel (Quelltext) oder null. */
export async function readSetArg(editor: Editor, func: SetFunc, name: string): Promise<string | null> {
  const f = await findSetRule(editor, func);
  if (!f) return null;
  for (const c of f.args.children) {
    if (c.kind !== 'Named') continue;
    const n = c.children[0];
    if (f.src.slice(n.start, n.end) !== name) continue;
    const value = c.children.filter((x) => !['Space', 'Colon', 'LineComment', 'BlockComment'].includes(x.kind))[1];
    return value ? f.src.slice(value.start, value.end) : null;
  }
  return null;
}

/**
 * Setzt (oder entfernt bei `value === null`) mehrere benannte Argumente einer
 * `#set`-Regel. Gibt es keine, wird eine neue Zeile in der Vorlage angelegt.
 */
export async function writeSetArgs(editor: Editor, func: SetFunc, values: Record<string, string | null>) {
  const f = await findSetRule(editor, func);
  if (!f) {
    const entries = Object.entries(values).filter(([, v]) => v !== null);
    if (!entries.length) return;
    const line = `#set ${func}(${entries.map(([k, v]) => `${k}: ${v}`).join(', ')})`;
    const blocks = codeBlocks(editor);
    const first = blocks[0];
    if (first) {
      const node = editor.state.doc.nodeAt(first.pos)!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(first.pos, undefined, { ...node.attrs, src: `${first.src}\n${line}` }));
    } else {
      const node = editor.schema.nodes.typstBlock.create({ src: line, kind: 'code' });
      editor.view.dispatch(editor.state.tr.insert(0, node));
    }
    return;
  }
  let src = f.src;
  // Von hinten nach vorn ersetzen, damit Positionen stimmen
  type Edit = { from: number; to: number; text: string };
  const edits: Edit[] = [];
  const named = new Map<string, Cst>();
  for (const c of f.args.children) if (c.kind === 'Named') named.set(src.slice(c.children[0].start, c.children[0].end), c);
  const closing = f.args.children.find((c) => c.kind === 'RightParen');
  const hasArgs = f.args.children.some((c) => !['LeftParen', 'RightParen', 'Space', 'Comma'].includes(c.kind));
  const inserts: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const existing = named.get(name);
    if (existing) {
      if (value === null) {
        // Argument samt folgendem Komma entfernen
        let end = existing.end;
        const after = src.slice(end);
        const m = after.match(/^\s*,\s*/);
        if (m) end += m[0].length;
        else {
          const before = src.slice(0, existing.start);
          const mb = before.match(/,\s*$/);
          edits.push({ from: existing.start - (mb ? mb[0].length : 0), to: end, text: '' });
          continue;
        }
        edits.push({ from: existing.start, to: end, text: '' });
      } else {
        const valueNode = existing.children.filter((x) => !['Space', 'Colon'].includes(x.kind))[1];
        if (valueNode) edits.push({ from: valueNode.start, to: valueNode.end, text: value });
      }
    } else if (value !== null) inserts.push(`${name}: ${value}`);
  }
  if (inserts.length && closing) {
    const before = src.slice(0, closing.start);
    const multiline = /\n\s*$/.test(before);
    const trailingComma = /,\s*$/.test(before);
    if (multiline) {
      const trimmed = before.replace(/\s*$/, '');
      const lastLine = trimmed.split('\n').pop() ?? '';
      const indent = lastLine.match(/^[ \t]*/)?.[0] || '  ';
      const comma = trailingComma || trimmed.endsWith('(') ? '' : ',';
      edits.push({ from: trimmed.length, to: trimmed.length, text: comma + inserts.map((s) => `\n${indent}${s},`).join('') });
    } else {
      edits.push({ from: closing.start, to: closing.start, text: (hasArgs && !trailingComma ? ', ' : '') + inserts.join(', ') });
    }
  }
  edits.sort((a, b) => b.from - a.from);
  for (const e of edits) src = src.slice(0, e.from) + e.text + src.slice(e.to);
  const node = editor.state.doc.nodeAt(f.pos)!;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(f.pos, undefined, { ...node.attrs, src }));
}
