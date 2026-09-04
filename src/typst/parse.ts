// Typst-Quelltext (als Syntaxbaum) → Editor-Dokument (ProseMirror-JSON).
//
// Grundsatz: Was der Editor als Text versteht, wird editierbar; alles andere
// bleibt als Typst-Code-Knoten erhalten und wird gerendert. Zu jedem Block merkt
// sich der Parser den Original-Quelltext, damit unveränderte Blöcke beim
// Speichern Zeichen für Zeichen gleich bleiben.

import { callInfo, contentMarkup, hasError, hydrate, nonTrivia, parenInner, type CallInfo, type Cst, type RawCst } from './cst';
import { readStringLiteral } from './values';

export interface J {
  type: string;
  attrs?: Record<string, unknown>;
  content?: J[];
  marks?: JMark[];
  text?: string;
}

export interface JMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** Quelltext-Ausschnitt eines Blocks für die Rücküberführung. */
export interface SourceRecord {
  json: J;
  src: string;
  /** Einrückung der Zeile, in der der Block beginnt (null: beginnt mitten in einer Zeile). */
  indent: string | null;
}

export interface ParseResult {
  doc: J;
  lead: string;
  trail: string;
  records: SourceRecord[];
}

type Item =
  | { t: 'ws'; text: string; start: number; end: number; nl: number }
  | { t: 'node'; node: Cst; start: number; end: number }
  | { t: 'code'; expr: Cst; start: number; end: number };

interface Ctx {
  src: string;
  records: SourceRecord[];
}

interface Placed {
  json: J;
  start: number;
  end: number;
}

const STATEMENT_KINDS = new Set(['LetBinding', 'SetRule', 'ShowRule', 'ModuleImport']);
const LABELABLE = new Set(['heading', 'figure', 'table', 'image', 'callBlock', 'mathBlock', 'typstBlock']);

const SHORTHANDS: Record<string, string> = {
  '~': ' ',
  '--': '–',
  '---': '—',
  '...': '…',
  '-?': '­',
};

export function parseTypst(src: string, raw: RawCst): ParseResult {
  const root = hydrate(raw);
  const ctx: Ctx = { src, records: [] };
  const { blocks, lead, trail } = parseBlocks(root.children, ctx);
  return {
    doc: { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] },
    lead,
    trail,
    records: ctx.records,
  };
}

// ------------------------------------------------------------------ Items

function countNl(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === '\n') n++;
  return n;
}

function toItems(children: Cst[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.kind === 'Space' || c.kind === 'Parbreak') {
      const text = c.leaf ?? '';
      items.push({ t: 'ws', text, start: c.start, end: c.end, nl: countNl(text) });
    } else if (c.kind === 'Hash' && i + 1 < children.length) {
      const expr = children[i + 1];
      let end = expr.end;
      i++;
      if (children[i + 1]?.kind === 'Semicolon') {
        end = children[i + 1].end;
        i++;
      }
      items.push({ t: 'code', expr, start: c.start, end });
    } else {
      items.push({ t: 'node', node: c, start: c.start, end: c.end });
    }
  }
  return items;
}

function lineIndent(src: string, pos: number): string | null {
  const lineStart = src.lastIndexOf('\n', pos - 1) + 1;
  const prefix = src.slice(lineStart, pos);
  return /^[ \t]*$/.test(prefix) ? prefix : null;
}

// ------------------------------------------------------------------ Blöcke

interface BlocksResult {
  blocks: J[];
  lead: string;
  trail: string;
}

function parseBlocks(children: Cst[], ctx: Ctx): BlocksResult {
  const { src } = ctx;
  const items = toItems(children);
  const out: Placed[] = [];
  let run: Item[] = [];
  let runSep = '';
  let pending = '';
  let lead = '';

  const emit = (json: J, start: number, end: number) => {
    json.attrs = { ...(json.attrs ?? {}), sep: out.length === 0 ? null : pending };
    if (out.length === 0) lead = pending;
    pending = '';
    out.push({ json, start, end });
  };

  const flush = () => {
    if (!run.length) return;
    let trailing = '';
    while (run.length && run[run.length - 1].t === 'ws') {
      const ws = run.pop()!;
      trailing = (ws as { text: string }).text + trailing;
    }
    if (run.length) {
      const content = parseInline(run, [], ctx);
      const start = run[0].start;
      const end = run[run.length - 1].end;
      pending = runSep;
      emit({ type: 'paragraph', content: content.length ? content : undefined }, start, end);
    }
    pending += trailing;
    run = [];
  };

  const pushRun = (it: Item) => {
    if (!run.length) {
      runSep = pending;
      pending = '';
    }
    run.push(it);
  };

  const lineStart = (i: number) => i === 0 || (items[i - 1].t === 'ws' && (items[i - 1] as { nl: number }).nl > 0);
  /** Index des letzten Items, das noch zur Zeile gehört (Kommentare am Zeilenende eingeschlossen), oder -1. */
  const lineEndAt = (i: number): number => {
    let j = i + 1;
    let last = i;
    while (j < items.length) {
      const it = items[j];
      if (it.t === 'ws' && it.nl === 0) {
        j++;
        continue;
      }
      if (it.t === 'node' && (it.node.kind === 'LineComment' || (it.node.kind === 'BlockComment' && !src.slice(it.start, it.end).includes('\n')))) {
        last = j;
        j++;
        continue;
      }
      break;
    }
    if (j >= items.length || (items[j].t === 'ws' && (items[j] as { nl: number }).nl > 0)) return last;
    return -1;
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.t === 'ws') {
      if (run.length && it.nl < 2) run.push(it);
      else {
        flush();
        pending += it.text;
      }
      continue;
    }

    if (it.t === 'code') {
      const endIdx = lineStart(i) ? lineEndAt(i) : -1;
      // Auszeichnung wie `#text(...)[...]` mitten in einem Absatz bleibt Teil des Absatzes
      const continuesParagraph = run.length > 0 && isInlineMarkCall(it.expr, src);
      if (endIdx >= 0 && !continuesParagraph) {
        flush();
        const end = items[endIdx].end;
        emit(blockFromCode(it.expr, it.start, end, ctx), it.start, end);
        i = endIdx;
      } else pushRun(it);
      continue;
    }

    const node = it.node;
    switch (node.kind) {
      case 'Heading': {
        flush();
        emit(parseHeading(node, ctx), it.start, it.end);
        break;
      }
      case 'ListItem':
      case 'EnumItem': {
        flush();
        addListItem(node, out, ctx, () => pending, (v) => (pending = v), emit);
        break;
      }
      case 'TermItem': {
        flush();
        emit({ type: 'typstBlock', attrs: { src: src.slice(it.start, it.end), kind: 'expr' } }, it.start, it.end);
        break;
      }
      case 'Equation': {
        const text = src.slice(it.start, it.end);
        const display = /^\$\s/.test(text) && /\s\$$/.test(text);
        if (display && lineStart(i) && lineEndAt(i) === i) {
          flush();
          emit({ type: 'mathBlock', attrs: { src: text } }, it.start, it.end);
        } else pushRun(it);
        break;
      }
      case 'Raw': {
        const text = src.slice(it.start, it.end);
        if (text.startsWith('```') && text.includes('\n') && lineStart(i) && lineEndAt(i) === i) {
          flush();
          emit(parseCodeBlock(node, text, ctx), it.start, it.end);
        } else pushRun(it);
        break;
      }
      case 'LineComment':
      case 'BlockComment': {
        if (!run.length && lineStart(i) && lineEndAt(i) >= i) {
          emit({ type: 'typstBlock', attrs: { src: src.slice(it.start, it.end), kind: 'comment' } }, it.start, it.end);
        } else pushRun(it);
        break;
      }
      case 'Label': {
        const last = out[out.length - 1];
        if (!run.length && last && LABELABLE.has(last.json.type) && countNl(pending) < 2 && !last.json.attrs?.label) {
          last.json.attrs = { ...last.json.attrs, label: src.slice(it.start + 1, it.end - 1), labelSep: pending };
          last.end = it.end;
          pending = '';
        } else pushRun(it);
        break;
      }
      default:
        pushRun(it);
    }
  }
  flush();
  const trail = pending;

  const merged = mergeCodeRegions(out, src);
  for (const p of merged) {
    ctx.records.push({ json: p.json, src: src.slice(p.start, p.end), indent: lineIndent(src, p.start) });
  }
  return { blocks: merged.map((p) => p.json), lead, trail };
}

const INLINE_MARK_CALLEES = new Set(['strong', 'emph', 'underline', 'strike', 'super', 'sub', 'smallcaps', 'highlight', 'text', 'link', 'footnote']);

function isInlineMarkCall(expr: Cst, src: string): boolean {
  const info = callInfo(expr, src);
  return !!info && INLINE_MARK_CALLEES.has(info.callee);
}

/** Aufeinanderfolgende Vorlagen-Zeilen (let/set/show/import, Kommentare) zu einem Block zusammenfassen. */
function mergeCodeRegions(blocks: Placed[], src: string): Placed[] {
  const out: Placed[] = [];
  const isRegion = (p: Placed) =>
    p.json.type === 'typstBlock' && (p.json.attrs?.kind === 'code' || p.json.attrs?.kind === 'comment') && !p.json.attrs?.label;
  for (const p of blocks) {
    const prev = out[out.length - 1];
    if (prev && isRegion(prev) && isRegion(p)) {
      const kind = prev.json.attrs?.kind === 'code' || p.json.attrs?.kind === 'code' ? 'code' : 'comment';
      // Kommentare nur mit Code zusammenfassen oder wenn sie direkt aneinander stehen
      const gap = src.slice(prev.end, p.start);
      if (kind === 'comment' && countNl(gap) > 1) {
        out.push(p);
        continue;
      }
      prev.json.attrs = { ...prev.json.attrs, src: src.slice(prev.start, p.end), kind };
      prev.end = p.end;
      continue;
    }
    out.push(p);
  }
  return out;
}

function parseHeading(node: Cst, ctx: Ctx): J {
  const marker = node.children.find((c) => c.kind === 'HeadingMarker');
  const markup = node.children.find((c) => c.kind === 'Markup');
  const level = Math.min(6, Math.max(1, marker?.leaf?.length ?? 1));
  const content = markup ? parseInline(toItems(markup.children), [], ctx) : [];
  return { type: 'heading', attrs: { level }, content: content.length ? content : undefined };
}

function parseCodeBlock(node: Cst, text: string, ctx: Ctx): J {
  const fence = text.match(/^`+/)![0];
  const lang = node.children.find((c) => c.kind === 'RawLang')?.leaf ?? null;
  const afterHeader = text.indexOf('\n') + 1;
  let body = text.slice(afterHeader, text.length - fence.length);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  void ctx;
  return {
    type: 'codeBlock',
    attrs: { language: lang, fence },
    content: body ? [{ type: 'text', text: body }] : undefined,
  };
}

// ------------------------------------------------------------------ Listen

function addListItem(
  node: Cst,
  out: Placed[],
  ctx: Ctx,
  getPending: () => string,
  setPending: (v: string) => void,
  emit: (json: J, start: number, end: number) => void,
) {
  const { src } = ctx;
  const bullet = node.kind === 'ListItem';
  const markerNode = node.children.find((c) => c.kind === (bullet ? 'ListMarker' : 'EnumMarker'));
  const marker = markerNode?.leaf ?? (bullet ? '-' : '+');
  const markup = node.children.find((c) => c.kind === 'Markup');
  const inner = markup ? parseBlocks(markup.children, ctx) : { blocks: [], lead: '', trail: '' };
  const blocks = inner.blocks.length ? [...inner.blocks] : [{ type: 'paragraph' } as J];
  if (blocks[0].type !== 'paragraph') blocks.unshift({ type: 'paragraph' });
  else blocks[0].attrs = { ...blocks[0].attrs, sep: null };

  const pending = getPending();
  const item: J = { type: 'listItem', attrs: { sep: null }, content: blocks };
  const listType = bullet ? 'bulletList' : 'orderedList';
  const last = out[out.length - 1];
  const number = /^\d+\.$/.test(marker) ? parseInt(marker, 10) : null;

  if (last && last.json.type === listType && pending.trim() === '' && (bullet || !!last.json.attrs?.explicit === (number !== null))) {
    item.attrs = { sep: pending };
    if (countNl(pending) >= 2) last.json.attrs = { ...last.json.attrs, tight: false };
    last.json.content!.push(item);
    last.end = node.end;
    setPending('');
  } else {
    const attrs: Record<string, unknown> = bullet
      ? { tight: true, marker }
      : { tight: true, explicit: number !== null, start: number ?? 1 };
    emit({ type: listType, attrs, content: [item] }, node.start, node.end);
  }
  ctx.records.push({ json: item, src: src.slice(node.start, node.end), indent: lineIndent(src, node.start) });
}

// ------------------------------------------------------------------ Code als Block

function blockFromCode(expr: Cst, start: number, end: number, ctx: Ctx): J {
  const { src } = ctx;
  const text = src.slice(start, end);
  const raw = (kind: string): J => ({ type: 'typstBlock', attrs: { src: text, kind } });
  if (hasError(expr)) return raw('expr');
  if (STATEMENT_KINDS.has(expr.kind)) return raw('code');
  if (expr.kind === 'ModuleInclude') return raw('include');
  const info = callInfo(expr, src);
  if (!info) return raw('expr');
  // Nur einfache Aufrufe ohne nachgestellten Code (z. B. Kommentar am Zeilenende) zerlegen
  if (expr.end !== end && src.slice(expr.end, end).trim() !== '') return raw('expr');
  return blockFromCall(info, ctx, false) ?? raw('expr');
}

function blockFromCall(info: CallInfo, ctx: Ctx, codeMode: boolean): J | null {
  const { src } = ctx;
  const inner = parenInner(info, src);
  const noArgs = inner === null || inner.trim() === '';
  switch (info.callee) {
    case 'pagebreak':
      if (info.trailing.length || codeMode) return null;
      return { type: 'pageBreak', attrs: { args: noArgs ? null : inner } };
    case 'line':
      if (info.trailing.length || codeMode) return null;
      return { type: 'horizontalRule', attrs: { args: noArgs ? null : inner } };
    case 'outline':
      if (info.trailing.length || codeMode) return null;
      return { type: 'toc', attrs: { args: noArgs ? null : inner } };
    case 'image':
      return parseImage(info, ctx, codeMode);
    case 'figure':
      return codeMode ? null : parseFigure(info, ctx);
    case 'table':
      return parseTable(info, ctx, codeMode);
    case 'align':
    case 'par': {
      if (codeMode || info.trailing.length !== 1 || info.positional.length + info.named.length !== 1) break;
      let align: string | null = null;
      if (info.callee === 'align' && info.positional.length === 1) {
        const v = src.slice(info.positional[0].start, info.positional[0].end);
        if (['left', 'center', 'right', 'start', 'end'].includes(v)) align = v === 'start' ? 'left' : v === 'end' ? 'right' : v;
      }
      if (info.callee === 'par' && info.named.length === 1 && info.named[0].name === 'justify') {
        const v = src.slice(info.named[0].value.start, info.named[0].value.end);
        if (v === 'true') align = 'justify';
        if (v === 'false') align = 'left';
      }
      if (!align) break;
      const markup = contentMarkup(info.trailing[0]);
      const body = markup ? parseBlocks(markup.children, ctx) : null;
      if (body && body.blocks.length === 1 && !body.lead && !body.trail) {
        const only = body.blocks[0];
        if ((only.type === 'paragraph' || only.type === 'heading') && !only.attrs?.align) {
          only.attrs = { ...only.attrs, align, sep: null };
          // Der innere Absatz darf nicht als eigener Quelltext-Block wiederverwendet werden
          ctx.records = ctx.records.filter((r) => r.json !== only);
          return only;
        }
      }
      break;
    }
    case 'quote': {
      if (codeMode || info.trailing.length !== 1) break;
      const isBlock = info.named.some((n) => n.name === 'block' && src.slice(n.value.start, n.value.end) === 'true');
      if (!isBlock) break;
      const markup = contentMarkup(info.trailing[0]);
      const body = markup ? parseBlocks(markup.children, ctx) : { blocks: [], lead: '', trail: '' };
      return {
        type: 'blockquote',
        attrs: { args: inner },
        content: body.blocks.length ? body.blocks : [{ type: 'paragraph' }],
      };
    }
  }
  if (codeMode) return null;
  // Eigene Funktion mit genau einem Inhaltsblock: Inhalt bleibt editierbar
  if (info.trailing.length === 1 && !info.spread && !info.positional.some((p) => p.kind === 'ContentBlock')) {
    const markup = contentMarkup(info.trailing[0]);
    const body = markup ? parseBlocks(markup.children, ctx) : { blocks: [], lead: '', trail: '' };
    // Ohne editierbaren Text (z. B. `#fig[#steps(...)]`) lieber als Ganzes rendern
    if (!body.blocks.some(hasEditableText)) return null;
    return {
      type: 'callBlock',
      attrs: { callee: info.callee, args: inner === null ? null : `(${inner})`, lead: body.lead, trail: body.trail },
      content: body.blocks,
    };
  }
  return null;
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'callBlock', 'table', 'codeBlock']);

function hasEditableText(block: J): boolean {
  if (!TEXT_BLOCKS.has(block.type)) return false;
  if (block.type === 'paragraph' || block.type === 'heading') {
    return (block.content ?? []).some((n) => n.type === 'text' && n.text!.trim() !== '');
  }
  return (block.content ?? []).some((c) => c.type === 'text' || hasEditableText(c) || (c.content ?? []).some(hasEditableText));
}

function parseImage(info: CallInfo, ctx: Ctx, codeMode: boolean): J | null {
  const { src } = ctx;
  if (info.trailing.length || info.spread || info.positional.length !== 1 || info.positional[0].kind !== 'Str') return null;
  const path = readStringLiteral(src.slice(info.positional[0].start, info.positional[0].end));
  if (path === null) return null;
  const attrs: Record<string, unknown> = { src: path, width: null, height: null, rest: null, code: codeMode };
  const rest: string[] = [];
  for (const n of info.named) {
    const value = src.slice(n.value.start, n.value.end);
    if (n.name === 'width') attrs.width = value;
    else if (n.name === 'height') attrs.height = value;
    else rest.push(src.slice(n.node.start, n.node.end));
  }
  if (rest.length) attrs.rest = rest.join(', ');
  return { type: 'image', attrs };
}

function parseFigure(info: CallInfo, ctx: Ctx): J | null {
  const { src } = ctx;
  if (info.trailing.length || info.spread || info.positional.length !== 1) return null;
  const bodyNode = info.positional[0];
  const bodyInfo = callInfo(bodyNode, src);
  if (!bodyInfo || (bodyInfo.callee !== 'image' && bodyInfo.callee !== 'table')) return null;
  const body = blockFromCall(bodyInfo, ctx, true);
  if (!body) return null;
  const rest: string[] = [];
  let caption: J | null = null;
  for (const n of info.named) {
    if (n.name === 'caption' && n.value.kind === 'ContentBlock') {
      const markup = contentMarkup(n.value);
      const items = markup ? toItems(markup.children) : [];
      if (items.some((i) => i.t === 'ws' && i.nl >= 2)) return null;
      const content = trimInline(parseInline(items, [], ctx));
      caption = { type: 'figcaption', content: content.length ? content : undefined };
    } else rest.push(src.slice(n.node.start, n.node.end));
  }
  return {
    type: 'figure',
    attrs: { rest: rest.length ? rest.join(', ') : null },
    content: caption ? [body, caption] : [body],
  };
}

function parseTable(info: CallInfo, ctx: Ctx, codeMode: boolean): J | null {
  const { src } = ctx;
  if (info.trailing.length || info.spread) return null;
  let columns: string | null = null;
  const rest: string[] = [];
  for (const n of info.named) {
    if (n.name === 'columns') columns = src.slice(n.value.start, n.value.end);
    else rest.push(src.slice(n.node.start, n.node.end));
  }
  const colCount = columnCount(columns, info, src);
  if (colCount === null || colCount < 1) return null;

  interface Cell {
    header: boolean;
    colspan: number;
    rowspan: number;
    content: J[];
  }
  const cells: Cell[] = [];
  const cellFrom = (node: Cst, header: boolean, colspan = 1, rowspan = 1): boolean => {
    if (node.kind === 'ContentBlock') {
      const markup = contentMarkup(node);
      const body = markup ? parseBlocks(markup.children, ctx) : { blocks: [] as J[] };
      cells.push({ header, colspan, rowspan, content: body.blocks.length ? body.blocks : [{ type: 'paragraph' }] });
      return true;
    }
    if (node.kind === 'Str') {
      const text = readStringLiteral(src.slice(node.start, node.end));
      if (text === null) return false;
      cells.push({
        header,
        colspan,
        rowspan,
        content: [{ type: 'paragraph', attrs: { sep: null }, content: text ? [{ type: 'text', text }] : undefined }],
      });
      return true;
    }
    const sub = callInfo(node, src);
    if (sub && sub.callee === `${info.callee}.cell` && sub.trailing.length === 1 && sub.positional.length === 0) {
      let cs = 1;
      let rs = 1;
      for (const n of sub.named) {
        const v = src.slice(n.value.start, n.value.end);
        if (!/^\d+$/.test(v)) return false;
        if (n.name === 'colspan') cs = parseInt(v, 10);
        else if (n.name === 'rowspan') rs = parseInt(v, 10);
        else return false;
      }
      return cellFrom(sub.trailing[0], header, cs, rs);
    }
    return false;
  };

  let headerCount = 0;
  for (const p of info.positional) {
    const sub = callInfo(p, src);
    if (sub && sub.callee === `${info.callee}.header`) {
      if (sub.named.length || sub.trailing.length || sub.spread || cells.length) return null;
      for (const hp of sub.positional) if (!cellFrom(hp, true)) return null;
      headerCount = cells.length;
      continue;
    }
    if (!cellFrom(p, false)) return null;
  }
  void headerCount;

  // Zellen wie Typst zeilenweise auf das Raster verteilen (inkl. colspan/rowspan)
  const rows: J[][] = [];
  const occupied: boolean[][] = [];
  const isFree = (r: number, c: number) => !occupied[r]?.[c];
  let r = 0;
  let c = 0;
  for (const cell of cells) {
    while (!isFree(r, c) || c >= colCount) {
      c++;
      if (c >= colCount) {
        c = 0;
        r++;
      }
    }
    const span = Math.min(cell.colspan, colCount - c);
    for (let dr = 0; dr < cell.rowspan; dr++) {
      occupied[r + dr] ??= [];
      for (let dc = 0; dc < span; dc++) occupied[r + dr][c + dc] = true;
    }
    rows[r] ??= [];
    rows[r].push({
      type: cell.header ? 'tableHeader' : 'tableCell',
      attrs: { colspan: span, rowspan: cell.rowspan, colwidth: null },
      content: cell.content,
    });
    c += span;
  }
  if (!rows.length) return null;
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  if (rows.some((row) => row.length === 0)) return null;

  return {
    type: 'table',
    attrs: { columns, rest: rest.length ? rest.join(', ') : null, func: info.callee, code: codeMode },
    content: rows.map((row) => ({ type: 'tableRow', content: row })),
  };
}

function columnCount(columns: string | null, info: CallInfo, src: string): number | null {
  if (columns === null) return 1;
  if (/^\d+$/.test(columns.trim())) return parseInt(columns, 10);
  const node = info.named.find((n) => n.name === 'columns')!.value;
  if (node.kind === 'Array') {
    const items = nonTrivia(node).filter((c) => !['LeftParen', 'RightParen', 'Comma'].includes(c.kind));
    if (items.some((c) => c.kind === 'Spread')) return null;
    return items.length;
  }
  void src;
  return null;
}

// ------------------------------------------------------------------ Inline

function addMark(marks: JMark[], mark: JMark): JMark[] {
  return [...marks, mark];
}

function textNode(text: string, marks: JMark[]): J {
  const node: J = { type: 'text', text };
  if (marks.length) node.marks = marks;
  return node;
}

function inlineAtom(type: string, attrs: Record<string, unknown>, marks: JMark[]): J {
  const node: J = { type, attrs };
  if (marks.length) node.marks = marks;
  return node;
}

function unescape(esc: string): string {
  const m = esc.match(/^\\u\{([0-9a-fA-F]+)\}$/);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  return esc.slice(1);
}

const MARK_CALLS: Record<string, string> = {
  strong: 'bold',
  emph: 'italic',
  underline: 'underline',
  strike: 'strike',
  super: 'superscript',
  sub: 'subscript',
  smallcaps: 'smallcaps',
};

const TEXT_ARGS = new Set(['fill', 'size', 'font', 'weight']);

function parseInline(items: Item[], marks: JMark[], ctx: Ctx): J[] {
  const { src } = ctx;
  const out: J[] = [];
  const push = (n: J) => {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      prev.text += n.text!;
    } else out.push(n);
  };
  const raw = (start: number, end: number, kind: string) =>
    push(inlineAtom('typstInline', { src: src.slice(start, end), kind }, marks));

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    if (it.t === 'ws') {
      // Leerraum direkt nach einem Zeilenumbruch (`\`) ist bedeutungslos
      const prev = items[idx - 1];
      if (prev?.t === 'node' && prev.node.kind === 'Linebreak') continue;
      push(textNode(' ', marks));
      continue;
    }
    if (it.t === 'code') {
      for (const n of inlineFromCode(it, marks, ctx)) push(n);
      continue;
    }
    const node = it.node;
    switch (node.kind) {
      case 'Text':
        push(textNode(node.leaf ?? '', marks));
        break;
      case 'Escape':
        push(textNode(unescape(node.leaf ?? ''), marks));
        break;
      case 'Shorthand': {
        const s = node.leaf ?? '';
        push(textNode(SHORTHANDS[s] ?? s, marks));
        break;
      }
      case 'SmartQuote':
        push(textNode(node.leaf ?? '"', marks));
        break;
      case 'Strong':
      case 'Emph': {
        const markup = node.children.find((c) => c.kind === 'Markup');
        const childItems = markup ? toItems(markup.children) : [];
        if (childItems.some((c) => c.t === 'ws' && c.nl >= 2)) {
          raw(it.start, it.end, 'raw');
          break;
        }
        const mark = { type: node.kind === 'Strong' ? 'bold' : 'italic' };
        for (const n of parseInline(childItems, addMark(marks, mark), ctx)) push(n);
        break;
      }
      case 'Raw': {
        const text = src.slice(it.start, it.end);
        const m = text.match(/^`([^`\n]+)`$/);
        if (m) push(textNode(m[1], addMark(marks, { type: 'code' })));
        else raw(it.start, it.end, 'raw');
        break;
      }
      case 'Link': {
        const url = src.slice(it.start, it.end);
        push(textNode(url, addMark(marks, { type: 'link', attrs: { href: url, form: 'bare' } })));
        break;
      }
      case 'Ref':
        raw(it.start, it.end, 'ref');
        break;
      case 'Label':
        raw(it.start, it.end, 'label');
        break;
      case 'Linebreak':
        push(inlineAtom('hardBreak', {}, marks));
        break;
      case 'Equation':
        push(inlineAtom('mathInline', { src: src.slice(it.start, it.end) }, marks));
        break;
      case 'LineComment':
      case 'BlockComment':
        raw(it.start, it.end, 'comment');
        break;
      default:
        raw(it.start, it.end, 'raw');
    }
  }
  return out;
}

function inlineFromCode(it: Extract<Item, { t: 'code' }>, marks: JMark[], ctx: Ctx): J[] {
  const { src } = ctx;
  const fallback = () => [inlineAtom('typstInline', { src: src.slice(it.start, it.end), kind: 'expr' }, marks)];
  if (hasError(it.expr) || it.end !== it.expr.end) return fallback();
  const info = callInfo(it.expr, src);
  if (!info || info.spread) return fallback();
  const inner = parenInner(info, src);

  // `#link("url")` ohne Inhalt: URL als verlinkter Text
  if (info.callee === 'link' && !info.trailing.length && info.positional.length === 1 && !info.named.length) {
    const href = readStringLiteral(src.slice(info.positional[0].start, info.positional[0].end));
    if (href === null) return fallback();
    return [textNode(href, addMark(marks, { type: 'link', attrs: { href, form: 'call' } }))];
  }
  if (info.trailing.length !== 1) return fallback();
  const markup = contentMarkup(info.trailing[0]);
  const bodyItems = markup ? toItems(markup.children) : [];
  if (bodyItems.some((c) => c.t === 'ws' && c.nl >= 2)) return fallback();
  if (markup && markup.children.some((c) => ['Heading', 'ListItem', 'EnumItem', 'TermItem'].includes(c.kind))) return fallback();
  if (!bodyItems.length) return fallback();

  let mark: JMark | null = null;
  const noParen = inner === null || inner.trim() === '';
  if (MARK_CALLS[info.callee] && noParen) mark = { type: MARK_CALLS[info.callee] };
  else if (info.callee === 'highlight') {
    if (noParen) mark = { type: 'highlight', attrs: { fill: null } };
    else if (info.named.length === 1 && info.named[0].name === 'fill' && !info.positional.length)
      mark = { type: 'highlight', attrs: { fill: src.slice(info.named[0].value.start, info.named[0].value.end) } };
  } else if (info.callee === 'text' && !info.positional.length && info.named.length) {
    const attrs: Record<string, string | null> = { fill: null, size: null, font: null, weight: null, rest: null };
    const rest: string[] = [];
    for (const n of info.named) {
      if (TEXT_ARGS.has(n.name)) attrs[n.name] = src.slice(n.value.start, n.value.end);
      else rest.push(src.slice(n.node.start, n.node.end));
    }
    if (rest.length) attrs.rest = rest.join(', ');
    mark = { type: 'textStyle', attrs };
  } else if (info.callee === 'link' && info.positional.length === 1 && !info.named.length) {
    const href = readStringLiteral(src.slice(info.positional[0].start, info.positional[0].end));
    if (href !== null) mark = { type: 'link', attrs: { href, form: 'call' } };
  }
  if (!mark) {
    if (info.positional.some((p) => p.kind === 'ContentBlock')) return fallback();
    mark = { type: 'callMark', attrs: { callee: info.callee, args: inner === null ? null : `(${inner})` } };
  }
  const content = parseInline(bodyItems, addMark(marks, mark), ctx);
  // Leerer oder nur aus Code bestehender Inhalt lässt sich nicht als Markierung darstellen
  if (!content.some((n) => n.type === 'text' && n.text!.trim() !== '')) return fallback();
  // Führende/folgende Leerzeichen im Inhalt würden beim Zurückschreiben verschoben
  if (content[0].type === 'text' && /^\s/.test(content[0].text!)) return fallback();
  const lastNode = content[content.length - 1];
  if (lastNode.type === 'text' && /\s$/.test(lastNode.text!)) return fallback();
  return content;
}

function trimInline(nodes: J[]): J[] {
  const out = nodes.map((n) => ({ ...n }));
  while (out.length && out[0].type === 'text' && out[0].text!.trim() === '') out.shift();
  while (out.length && out[out.length - 1].type === 'text' && out[out.length - 1].text!.trim() === '') out.pop();
  if (out.length && out[0].type === 'text') out[0].text = out[0].text!.replace(/^\s+/, '');
  if (out.length && out[out.length - 1].type === 'text') out[out.length - 1].text = out[out.length - 1].text!.replace(/\s+$/, '');
  return out;
}
