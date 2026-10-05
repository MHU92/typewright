// Typst-Code im Editor sichtbar machen: Code-Blöcke und Formeln werden als
// eigene Seiten eines Hilfsdokuments gerendert, Inline-Ausdrücke (z. B. `#euro(599)`)
// zu Text ausgewertet. Das Hilfsdokument enthält die Vorlage (let/set/show/import)
// des Dokuments, damit alles so aussieht wie in der Ausgabe.

import { useSyncExternalStore } from 'react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Diagnostic, SnippetResult } from '../shared/api';

export type SnippetKind = 'block' | 'math' | 'math-inline' | 'inline';

export interface SnippetRender {
  status: 'pending' | 'ok' | 'error';
  url?: string;
  width?: number;
  height?: number;
  /** Ausgewerteter Text bei Inline-Ausdrücken (null: kein reiner Text). */
  text?: string | null;
  /** Hintergrundfarbe, wenn ein Inline-Ausdruck eine Box mit Füllung ergibt. */
  fill?: string | null;
  /** Gerendert, aber ohne sichtbaren Inhalt. */
  empty?: boolean;
  error?: string;
}

export interface Geometry {
  pageWidth: number;
  pageHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  contentWidth: number;
  font: string[];
  size: number;
  lang: string;
  fill: string | null;
  justify: boolean;
  leading: number;
  spacing: number;
  headingNumbering: string | null;
  columns: number;
  flipped: boolean;
}

export const key = (kind: SnippetKind, src: string) => `${kind}\u0000${src}`;

type Listener = () => void;

class RenderStore {
  private map = new Map<string, SnippetRender>();
  private listeners = new Set<Listener>();
  geometry: Geometry | null = null;
  version = 0;

  get(k: string) {
    return this.map.get(k);
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  update(entries: Map<string, SnippetRender>, geometry: Geometry | null) {
    for (const [k, v] of entries) this.map.set(k, v);
    if (geometry) this.geometry = geometry;
    this.version++;
    for (const fn of this.listeners) fn();
  }

  markPending(keys: string[]) {
    let changed = false;
    for (const k of keys) {
      if (!this.map.has(k)) {
        this.map.set(k, { status: 'pending' });
        changed = true;
      }
    }
    if (changed) {
      this.version++;
      for (const fn of this.listeners) fn();
    }
  }

  clear() {
    this.map.clear();
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

export const renders = new RenderStore();

export function useRender(kind: SnippetKind, src: string): SnippetRender | undefined {
  const k = key(kind, src);
  return useSyncExternalStore(renders.subscribe, () => renders.get(k));
}

export function useGeometry(): Geometry | null {
  return useSyncExternalStore(renders.subscribe, () => renders.geometry);
}

// ------------------------------------------------------------------ Hilfsdokument

interface Entry {
  kind: SnippetKind;
  src: string;
  /** Zeilenbereich im Hilfsdokument (für Fehlerzuordnung). */
  from: number;
  to: number;
  index: number;
}

export interface SnippetPlan {
  text: string;
  entries: Entry[];
  signature: string;
  /** Zeilen der Vorlage aus der Hauptdatei (bei Kapiteln). */
  preambleLines: number;
}

const PAGE_RESET = 'header: none, footer: none, background: none, foreground: none, numbering: none, fill: none';

/**
 * Baut das Hilfsdokument. `mainPreamble` ist die Vorlage der Hauptdatei (Pfade
 * schon auf die Projektwurzel umgeschrieben), `skip` sind Schnipsel, die beim
 * letzten Versuch Fehler hatten.
 */
export function planSnippets(
  doc: PMNode,
  mainPreamble: string | null,
  skip: Set<string>,
  dropShowAll = false,
  margins: [number, number] | null = null,
): SnippetPlan {
  // Feste Seitenränder, sonst wechseln sie bei inside/outside von Seite zu Seite
  const sideMargins = margins ? `, left: ${margins[0].toFixed(2)}pt, right: ${margins[1].toFixed(2)}pt` : '';
  const lines: string[] = [];
  const entries: Entry[] = [];
  const sig: string[] = [];
  let lineNo = 1;
  const add = (text: string) => {
    lines.push(text);
    lineNo += text.split('\n').length;
  };
  // Querverweise auf Marken außerhalb des Schnipsels dürfen nicht scheitern
  add(
    '#show ref: it => context { if query(it.target).len() > 0 { it } else { text(fill: rgb("#1e3f73"))[#str(it.target)] } }',
  );
  if (mainPreamble) {
    add(mainPreamble);
    sig.push('M', mainPreamble);
  }
  const preambleLines = lineNo - 1;

  const snippet = (kind: SnippetKind, src: string) => {
    const k = key(kind, src);
    if (skip.has(k)) return;
    const index = entries.length;
    const marker = `#metadata(${index})<tw-snip>`;
    const from = lineNo;
    if (kind === 'block' || kind === 'math') {
      add(`#page(height: auto, margin: (top: 3pt, bottom: 3pt${sideMargins}), ${PAGE_RESET})[${marker}\n${src}\n]`);
    } else if (kind === 'math-inline') {
      add(`#page(width: auto, height: auto, margin: (x: 0.5pt, y: 2pt), ${PAGE_RESET})[${marker}${src}]`);
    } else {
      add(`#metadata((${index}, [${src}]))<tw-inl>`);
    }
    entries.push({ kind, src, from, to: lineNo - 1, index });
    sig.push(kind, src);
  };

  const walk = (node: PMNode, topLevel: boolean) => {
    node.forEach((child) => {
      const t = child.type.name;
      if (t === 'typstBlock') {
        const kind = child.attrs.kind as string;
        if (kind === 'code') {
          // Verschachtelte Vorlagen-Zeilen (z. B. `#let` in einem Block) nur als Definitionen,
          // ihre set/show-Regeln gelten in Typst nur innerhalb des Blocks
          let code = topLevel ? child.attrs.src : stripStatements(child.attrs.src, /^\s*#(set|show)\b/);
          if (dropShowAll) code = stripStatements(code, /^\s*#show:\s/);
          add(code);
          sig.push('C', code);
        } else if (kind === 'expr') snippet('block', child.attrs.src);
        return;
      }
      if (t === 'mathBlock') return snippet('math', child.attrs.src);
      if (t === 'mathInline') return snippet('math-inline', child.attrs.src);
      if (t === 'typstInline') {
        if (child.attrs.kind === 'expr' && String(child.attrs.src).startsWith('#')) snippet('inline', child.attrs.src);
        return;
      }
      if (child.isTextblock || child.childCount) walk(child, false);
    });
  };
  walk(doc, true);
  sig.push('R', sideMargins);

  add(
    '#context [#metadata((pw: page.width, ph: page.height, margin: page.margin, flipped: page.flipped, columns: page.columns, ' +
      'font: text.font, size: text.size.to-absolute(), lang: text.lang, fill: text.fill, justify: par.justify, ' +
      'leading: par.leading.to-absolute(), spacing: par.spacing.to-absolute(), hnum: heading.numbering))<tw-probe>]',
  );
  add('#context layout(s => [#metadata((w: s.width, x: here().position().x))<tw-probe-layout>])');
  return { text: lines.join('\n') + '\n', entries, signature: sig.join('\u0001'), preambleLines };
}

export const EVAL_EXPR =
  '(probe: query(<tw-probe>).map(m => m.value), lay: query(<tw-probe-layout>).map(m => m.value), ' +
  'snip: query(<tw-snip>).map(m => (m.value, m.location().page())), inl: query(<tw-inl>).map(m => m.value))';

// ------------------------------------------------------------------ Auswertung

const pt = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  // "0% + 62.36pt" oder "62.36pt"
  const m = s.match(/(-?[\d.]+)pt/);
  return m ? parseFloat(m[1]) : 0;
};

function parseColor(v: unknown): string | null {
  const s = String(v ?? '');
  const m = s.match(/rgb\("(#[0-9a-fA-F]{6,8})"\)/);
  if (m) return m[1];
  const l = s.match(/luma\(([\d.]+)%?\)/);
  if (l) {
    const n = Math.round(parseFloat(l[1]) * (s.includes('%') ? 2.55 : 1));
    return `rgb(${n}, ${n}, ${n})`;
  }
  return null;
}

export function parseGeometry(value: unknown): Geometry | null {
  const v = value as { probe?: Record<string, unknown>[]; lay?: { w: string; x: string }[] } | null;
  const p = v?.probe?.[v.probe.length - 1];
  if (!p) return null;
  const lay = v?.lay?.[v.lay.length - 1];
  const pw = pt(p.pw);
  const ph = p.ph === 'auto' ? pt(p.pw) * 1.414 : pt(p.ph);
  const margin = p.margin as Record<string, string> | string | null;
  let ml: number, mr: number, mt: number, mb: number;
  if (margin && typeof margin === 'object') {
    ml = pt(margin.left ?? margin.inside ?? margin.x);
    mr = pt(margin.right ?? margin.outside ?? margin.x);
    mt = pt(margin.top ?? margin.y);
    mb = pt(margin.bottom ?? margin.y);
  } else {
    const auto = (2.5 / 21) * Math.min(pw, ph);
    ml = mr = mt = mb = auto;
  }
  if (lay) {
    ml = pt(lay.x);
    mr = Math.max(0, pw - ml - pt(lay.w));
  }
  const font = Array.isArray(p.font) ? (p.font as string[]) : [String(p.font ?? 'libertinus serif')];
  return {
    pageWidth: pw,
    pageHeight: ph,
    marginLeft: ml,
    marginRight: mr,
    marginTop: mt,
    marginBottom: mb,
    contentWidth: lay ? pt(lay.w) : pw - ml - mr,
    font,
    size: pt(p.size) || 11,
    lang: String(p.lang ?? 'en'),
    fill: parseColor(p.fill),
    justify: p.justify === true,
    leading: pt(p.leading) || 7.15,
    spacing: pt(p.spacing) || 13.2,
    headingNumbering: typeof p.hnum === 'string' ? p.hnum : null,
    columns: Number(p.columns) || 1,
    flipped: p.flipped === true,
  };
}

interface ContentJson {
  func?: string;
  text?: string;
  children?: ContentJson[];
  child?: ContentJson;
  body?: ContentJson;
  fill?: string;
  double?: boolean;
}

/** Inhalt (JSON aus `typst eval`) zu reinem Text; null, wenn mehr als Text drinsteckt. */
export function contentText(v: unknown): string | null {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const c = v as ContentJson;
  switch (c.func) {
    case 'text':
    case 'symbol':
      return c.text ?? '';
    case 'space':
      return ' ';
    case 'linebreak':
      return ' ';
    case 'smartquote':
      return c.double ? '"' : "'";
    case 'sequence': {
      const parts = (c.children ?? []).map(contentText);
      return parts.some((p) => p === null) ? null : parts.join('');
    }
    case 'styled':
      return contentText(c.child);
    case 'strong':
    case 'emph':
    case 'underline':
    case 'highlight':
    case 'box':
    case 'text-style':
    case 'smallcaps':
    case 'upper':
    case 'lower':
      return c.body ? contentText(c.body) : null;
    default:
      if (c.body) return contentText(c.body);
      if (c.child) return contentText(c.child);
      return null;
  }
}

function contentFill(v: unknown): string | null {
  const c = v as ContentJson | null;
  if (!c || typeof c !== 'object') return null;
  if ((c.func === 'box' || c.func === 'highlight') && c.fill) return parseColor(c.fill);
  if (c.func === 'sequence' && c.children?.length === 1) return contentFill(c.children[0]);
  return null;
}

function errorFor(entries: Entry[], diags: Diagnostic[], preambleLines: number): { failed: Set<number>; preamble: boolean; message: string } {
  const failed = new Set<number>();
  let preamble = false;
  let message = '';
  for (const d of diags) {
    if (d.severity !== 'error') continue;
    message ||= d.message;
    if (d.file !== '<snippets>') continue;
    const e = entries.find((x) => d.line >= x.from && d.line <= x.to);
    if (e) failed.add(e.index);
    else if (d.line <= preambleLines) preamble = true;
  }
  return { failed, preamble, message };
}

export interface RenderOutcome {
  geometry: Geometry | null;
  ms: number;
  error: string | null;
}

/**
 * Rendert alle Schnipsel. Bei Fehlern werden die betroffenen Schnipsel markiert
 * und der Rest erneut versucht (höchstens dreimal).
 */
export async function renderSnippets(
  doc: PMNode,
  docText: string,
  mainPreamble: string | null,
  run: (text: string, doc: string, evalExpr: string) => Promise<SnippetResult>,
  margins: [number, number] | null = null,
): Promise<RenderOutcome> {
  const skip = new Set<string>();
  const errors = new Map<string, string>();
  let preamble = mainPreamble;
  let lastError: string | null = null;
  let dropShowAll = false;
  const started = performance.now();

  for (let attempt = 0; attempt < 5; attempt++) {
    const plan = planSnippets(doc, preamble, skip, dropShowAll, margins);
    renders.markPending(plan.entries.map((e) => key(e.kind, e.src)));
    const res = await run(docText, plan.text, EVAL_EXPR);
    if (res.ok && res.evalOk) {
      const value = res.value as { snip?: [number, number][]; inl?: [number, unknown][] };
      const pageOf = new Map<number, number>();
      for (const [idx, page] of value.snip ?? []) if (!pageOf.has(idx)) pageOf.set(idx, page);
      const inl = new Map<number, unknown>();
      for (const [idx, content] of value.inl ?? []) inl.set(idx, content);
      const out = new Map<string, SnippetRender>();
      for (const e of plan.entries) {
        const k = key(e.kind, e.src);
        if (e.kind === 'inline') {
          const content = inl.get(e.index);
          out.set(k, { status: 'ok', text: contentText(content), fill: contentFill(content) });
          continue;
        }
        const page = res.pages[(pageOf.get(e.index) ?? 0) - 1];
        if (!page) {
          out.set(k, { status: 'error', error: 'Kein Ergebnis' });
          continue;
        }
        const empty = e.kind === 'block' ? page.height <= 6.5 : page.width <= 1.5;
        out.set(k, { status: 'ok', url: page.url, width: page.width, height: page.height, empty });
      }
      for (const [k, msg] of errors) out.set(k, { status: 'error', error: msg });
      renders.update(out, parseGeometry(res.value));
      return { geometry: renders.geometry, ms: performance.now() - started, error: lastError };
    }
    const diags = [...res.diagnostics, ...res.evalDiagnostics];
    const { failed, preamble: inPreamble, message } = errorFor(plan.entries, diags, plan.preambleLines);
    lastError = message || 'Typst-Fehler';
    if (inPreamble && preamble) {
      preamble = null;
      continue;
    }
    // `#show: vorlage` packt alles in Container, dort sind Seiten verboten
    if (!dropShowAll && failed.size >= plan.entries.filter((e) => e.kind !== 'inline').length && /container|not allowed/i.test(lastError)) {
      dropShowAll = true;
      continue;
    }
    if (!failed.size) break;
    for (const e of plan.entries) {
      if (failed.has(e.index)) {
        const k = key(e.kind, e.src);
        skip.add(k);
        const d = diags.find((x) => x.file === '<snippets>' && x.line >= e.from && x.line <= e.to);
        errors.set(k, d ? d.message : message);
      }
    }
  }
  // Ganz gescheitert: alle als Fehler markieren, Geometrie behalten
  const out = new Map<string, SnippetRender>();
  const plan = planSnippets(doc, null, new Set());
  for (const e of plan.entries) out.set(key(e.kind, e.src), { status: 'error', error: errors.get(key(e.kind, e.src)) ?? lastError ?? 'Fehler' });
  renders.update(out, null);
  return { geometry: renders.geometry, ms: performance.now() - started, error: lastError };
}

/** Vorlage einer Hauptdatei: alle Code-Zeilen vor dem ersten Inhalt, Pfade relativ zur Wurzel. */
export function rewritePaths(code: string, mainDir: string, root: string): string {
  return code.replace(
    /((?:import|include|read|image|json|csv|yaml|toml|xml|cbor|plugin|bibliography)\s*\(?\s*)"([^"@/][^"]*)"/g,
    (_m, pre: string, p: string) => {
      const abs = normalizePath(`${mainDir}/${p}`);
      const rel = abs.startsWith(root) ? abs.slice(root.length) : abs;
      return `${pre}"${rel.startsWith('/') ? rel : '/' + rel}"`;
    },
  );
}

/** Entfernt Anweisungen, deren erste Zeile `start` trifft (auch mehrzeilig, bis die Klammern aufgehen). */
function stripStatements(code: string, start: RegExp): string {
  const lines = code.split('\n');
  const out: string[] = [];
  let depth = 0;
  let skipping = false;
  for (const line of lines) {
    if (!skipping && start.test(line)) {
      skipping = true;
      depth = 0;
    }
    if (skipping) {
      for (const ch of line) {
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth--;
      }
      out.push('');
      if (depth <= 0) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return '/' + out.join('/');
}
