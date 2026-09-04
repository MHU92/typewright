// Editor-Dokument (ProseMirror-JSON) → Typst-Quelltext.
//
// Unveränderte Blöcke kommen über die PreserveMap Zeichen für Zeichen aus dem
// Original zurück. Nur geänderte oder neue Blöcke werden frisch geschrieben.

import type { J, JMark } from './parse';
import { stringLiteral } from './values';

export interface Preserved {
  src: string;
  indent: string | null;
}

/** Schlüssel (kanonisches JSON ohne eigenes `sep`) → Original-Quelltext. */
export type PreserveMap = Map<string, Preserved>;

export interface SerializeOptions {
  preserve?: PreserveMap | null;
  /** Ist im Dokument Blocksatz voreingestellt? Steuert, wie „linksbündig“ geschrieben wird. */
  justifyDefault?: boolean;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function blockKey(block: J): string {
  const attrs = { ...(block.attrs ?? {}) };
  delete attrs.sep;
  return stableStringify({ ...block, attrs });
}

export function serializeTypst(doc: J, lead: string, trail: string, options: SerializeOptions = {}): string {
  const s = new Serializer(options);
  return lead + s.blocks(doc.content ?? [], '') + trail;
}

/** Einzelnen Block (z. B. für Vorschau-Schnipsel) schreiben. */
export function serializeBlock(block: J, options: SerializeOptions = {}): string {
  return new Serializer(options).block(block, '');
}

/** Inline-Inhalt (z. B. eingefügter Text) schreiben. */
export function serializeInlineContent(nodes: J[], options: SerializeOptions = {}): string {
  return new Serializer(options).inline(nodes, '');
}

const countNl = (s: string) => (s.match(/\n/g) ?? []).length;

const TEXTLIKE = new Set(['paragraph']);

function isEmptyParagraph(b: J): boolean {
  return b.type === 'paragraph' && !(b.content ?? []).length;
}

function reindent(src: string, from: string, to: string): string {
  if (from === to) return src;
  return src
    .split('\n')
    .map((line, i) => (i > 0 && line.startsWith(from) ? to + line.slice(from.length) : i > 0 && line.trim() === '' ? line : line))
    .join('\n');
}

class Serializer {
  constructor(private opts: SerializeOptions) {}

  private preserved(b: J, indent: string): string | null {
    const map = this.opts.preserve;
    if (!map) return null;
    const hit = map.get(blockKey(b));
    if (!hit) return null;
    if (hit.indent === null || hit.indent === indent) return hit.src;
    return reindent(hit.src, hit.indent, indent);
  }

  blocks(blocks: J[], indent: string, strictIndent = false): string {
    let out = '';
    let prev: J | null = null;
    for (const b of blocks) {
      if (isEmptyParagraph(b)) continue;
      const text = this.block(b, indent);
      if (prev) out += this.sep(prev, b, indent, strictIndent);
      out += text;
      prev = b;
    }
    return out;
  }

  /** Leerraum zwischen zwei Blöcken. In Listen zählt die Einrückung, sonst bleibt das Original. */
  private sep(prev: J, b: J, indent: string, strictIndent = false): string {
    const raw = typeof b.attrs?.sep === 'string' ? (b.attrs.sep as string) : null;
    let min = 1;
    if (TEXTLIKE.has(prev.type) && TEXTLIKE.has(b.type)) min = 2;
    if (prev.type === b.type && (b.type === 'bulletList' || b.type === 'orderedList')) min = 2;
    if (raw !== null && countNl(raw) >= min) {
      const lastLine = raw.slice(raw.lastIndexOf('\n') + 1);
      if (lastLine === indent || (!strictIndent && /^[ \t]*$/.test(lastLine))) return raw;
      return '\n'.repeat(countNl(raw)) + indent;
    }
    const isCode = (x: J) => x.type === 'typstBlock' && (x.attrs?.kind === 'code' || x.attrs?.kind === 'comment');
    const nl = Math.max(min, isCode(prev) && isCode(b) ? 1 : 2);
    return '\n'.repeat(nl) + indent;
  }

  block(b: J, indent: string): string {
    const kept = this.preserved(b, indent);
    if (kept !== null) return kept;
    const a = b.attrs ?? {};
    let out: string;
    switch (b.type) {
      case 'paragraph':
        out = this.align(this.inline(b.content ?? [], indent), a.align as string | null);
        break;
      case 'heading': {
        const level = Math.min(6, Math.max(1, Number(a.level) || 1));
        out = this.align('='.repeat(level) + ' ' + this.inline(b.content ?? [], indent, false), a.align as string | null);
        break;
      }
      case 'bulletList':
      case 'orderedList':
        out = this.list(b, indent);
        break;
      case 'codeBlock': {
        const text = (b.content ?? []).map((n) => n.text ?? '').join('');
        let fence = (a.fence as string) || '```';
        while (text.includes(fence)) fence += '`';
        out = fence + ((a.language as string) ?? '') + '\n' + text + '\n' + fence;
        break;
      }
      case 'blockquote': {
        const args = (a.args as string | null) ?? 'block: true';
        out = `#quote(${args})[\n` + this.blocks(b.content ?? [], indent) + '\n' + indent + ']';
        break;
      }
      case 'horizontalRule':
        out = `#line(${(a.args as string | null) ?? 'length: 100%'})`;
        break;
      case 'pageBreak':
        out = `#pagebreak(${(a.args as string | null) ?? ''})`;
        break;
      case 'toc':
        out = `#outline(${(a.args as string | null) ?? ''})`;
        break;
      case 'mathBlock':
      case 'typstBlock':
        out = String(a.src ?? '');
        break;
      case 'callBlock':
        out = this.callBlock(b, indent);
        break;
      case 'image':
        out = this.image(b, false);
        break;
      case 'figure':
        out = this.figure(b, indent);
        break;
      case 'table':
        out = this.table(b, indent, false);
        break;
      default:
        out = '';
    }
    if (a.label) out += ((a.labelSep as string | null) ?? ' ') + `<${a.label}>`;
    return out;
  }

  private align(body: string, align: string | null | undefined): string {
    switch (align) {
      case 'center':
      case 'right':
        return `#align(${align})[${body}]`;
      case 'justify':
        return this.opts.justifyDefault ? body : `#par(justify: true)[${body}]`;
      case 'left':
        return this.opts.justifyDefault ? `#par(justify: false)[${body}]` : body;
      default:
        return body;
    }
  }

  private list(b: J, indent: string): string {
    const a = b.attrs ?? {};
    const ordered = b.type === 'orderedList';
    const start = Number(a.start ?? 1) || 1;
    const explicit = ordered && !!a.explicit;
    const tight = a.tight !== false;
    let out = '';
    (b.content ?? []).forEach((item, i) => {
      const marker = ordered ? (explicit ? `${start + i}.` : '+') : ((a.marker as string) || '-');
      if (i > 0) {
        const raw = typeof item.attrs?.sep === 'string' ? (item.attrs.sep as string) : null;
        const nl = raw !== null && countNl(raw) >= 1 ? countNl(raw) : tight ? 1 : 2;
        out += '\n'.repeat(nl) + indent;
      }
      out += this.listItem(item, indent, marker);
    });
    return out;
  }

  private listItem(item: J, indent: string, marker: string): string {
    const kept = this.preserved(item, indent);
    if (kept !== null && kept.startsWith(marker + ' ')) return kept;
    const inner = indent + ' '.repeat(marker.length + 1);
    const [first, ...rest] = item.content ?? [];
    let out = marker + ' ';
    if (first) out += this.block(first, inner);
    let prev = first;
    for (const b of rest) {
      if (isEmptyParagraph(b)) continue;
      out += prev && !isEmptyParagraph(prev) ? this.sep(prev, b, inner, true) : '';
      out += this.block(b, inner);
      prev = b;
    }
    return out.replace(/ $/, '');
  }

  private callBlock(b: J, indent: string): string {
    const a = b.attrs ?? {};
    const lead = typeof a.lead === 'string' ? a.lead : '\n';
    const trail = typeof a.trail === 'string' ? a.trail : '\n';
    const bodyIndent = lead.includes('\n') ? lead.slice(lead.lastIndexOf('\n') + 1) : indent;
    const body = this.blocks(b.content ?? [], bodyIndent);
    return `#${a.callee}${(a.args as string | null) ?? ''}[${lead}${body}${trail}]`;
  }

  private image(b: J, code: boolean): string {
    const a = b.attrs ?? {};
    const parts = [stringLiteral(String(a.src ?? ''))];
    if (a.width) parts.push(`width: ${a.width}`);
    if (a.height) parts.push(`height: ${a.height}`);
    if (a.rest) parts.push(String(a.rest));
    return `${code || a.code ? '' : '#'}image(${parts.join(', ')})`;
  }

  private figure(b: J, indent: string): string {
    const a = b.attrs ?? {};
    const [body, caption] = b.content ?? [];
    const inner = indent + '  ';
    const lines: string[] = [];
    if (body?.type === 'image') lines.push(this.image(body, true));
    else if (body?.type === 'table') lines.push(this.table(body, inner, true));
    if (caption && (caption.content ?? []).length) lines.push(`caption: [${this.inline(caption.content ?? [], inner)}]`);
    if (a.rest) lines.push(String(a.rest));
    return `#figure(\n${lines.map((l) => inner + l + ',').join('\n')}\n${indent})`;
  }

  private table(b: J, indent: string, code: boolean): string {
    const a = b.attrs ?? {};
    const func = (a.func as string) || 'table';
    const inner = indent + '  ';
    const rows = b.content ?? [];
    const colCount = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((n, c) => n + (Number(c.attrs?.colspan) || 1), 0)));
    const lines: string[] = [];
    lines.push(`columns: ${adjustColumns(a.columns as string | null, colCount)},`);
    if (a.rest) lines.push(`${a.rest},`);
    const cell = (c: J) => {
      const blocks = c.content ?? [];
      const single = blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].attrs?.align;
      const body = single ? this.inline(blocks[0].content ?? [], inner) : this.blocks(blocks, inner);
      const cs = Number(c.attrs?.colspan) || 1;
      const rs = Number(c.attrs?.rowspan) || 1;
      if (cs > 1 || rs > 1) {
        const args = [cs > 1 ? `colspan: ${cs}` : '', rs > 1 ? `rowspan: ${rs}` : ''].filter(Boolean).join(', ');
        return `${func}.cell(${args})[${body}]`;
      }
      return `[${body}]`;
    };
    let headerRows = 0;
    while (headerRows < rows.length && (rows[headerRows].content ?? []).every((c) => c.type === 'tableHeader')) headerRows++;
    if (headerRows === rows.length) headerRows = 0;
    if (headerRows > 0) {
      const cells = rows.slice(0, headerRows).flatMap((r) => (r.content ?? []).map(cell));
      lines.push(`${func}.header(${cells.join(', ')}),`);
    }
    for (const r of rows.slice(headerRows)) lines.push((r.content ?? []).map(cell).join(', ') + ',');
    return `${code || a.code ? '' : '#'}${func}(\n${lines.map((l) => inner + l).join('\n')}\n${indent})`;
  }

  // ---------------------------------------------------------------- Inline

  inline(nodes: J[], indent: string, escapeStart = true): string {
    const w = new InlineWriter(indent, escapeStart);
    nodes = mergeTextNodes(nodes);
    for (let i = 0; i < nodes.length; i++) {
      if (i < w.skipUntil) continue;
      const n = nodes[i];
      w.syncMarks(n.marks ?? [], nodes, i);
      if (i < w.skipUntil) continue;
      w.content(n, nodes[i + 1]);
    }
    w.syncMarks([], nodes, nodes.length);
    return w.out;
  }
}

function adjustColumns(columns: string | null, count: number): string {
  if (!columns || /^\d+$/.test(columns.trim())) return String(count);
  const m = columns.trim().match(/^\((.*)\)$/s);
  if (!m) return columns;
  const items = splitTopLevel(m[1]).filter((s) => s.trim() !== '');
  if (items.length === count) return columns;
  const next = items.slice(0, count).map((s) => s.trim());
  while (next.length < count) next.push('1fr');
  return `(${next.join(', ')}${next.length === 1 ? ',' : ''})`;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === '\\') cur += s[++i] ?? '';
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function sameMark(a: JMark, b: JMark): boolean {
  return a.type === b.type && stableStringify(a.attrs ?? {}) === stableStringify(b.attrs ?? {});
}

function mergeTextNodes(nodes: J[]): J[] {
  const out: J[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (
      n.type === 'text' &&
      prev?.type === 'text' &&
      (prev.marks ?? []).length === (n.marks ?? []).length &&
      (prev.marks ?? []).every((m, i) => sameMark(m, n.marks![i]))
    ) {
      out[out.length - 1] = { ...prev, text: prev.text! + n.text! };
    } else out.push(n);
  }
  return out;
}

const URL_RE = /^https?:\/\/[^\s\[\]<>"]+$/;

/** Schreibt Inline-Inhalt; verwaltet offene Markierungen wie einen Stapel. */
class InlineWriter {
  out = '';
  skipUntil = -1;
  private stack: { mark: JMark; close: string }[] = [];
  private atLineStart: boolean;
  /** Letztes Element war Code (`#...`), der ggf. mit `;` abgeschlossen werden muss. */
  private codeTail: 'ident' | 'call' | null = null;

  constructor(
    private indent: string,
    escapeStart: boolean,
  ) {
    this.atLineStart = escapeStart;
  }

  private emit(s: string) {
    if (!s) return;
    this.out += s;
  }

  /** Text, der direkt auf Code folgt, darf den Ausdruck nicht verlängern. */
  private guardCode(next: string) {
    if (!this.codeTail || !next) return;
    // Nach `#name` verlängern Buchstaben, `-`, `.name`, `(` und `[` den Ausdruck; nach `)`/`]` nur `.name`, `(` und `[`
    const needs =
      this.codeTail === 'ident' ? /^([\p{L}\p{N}_-]|\.[\p{L}_]|[([])/u.test(next) : /^(\.[\p{L}_]|[([])/u.test(next);
    if (needs) this.out += ';';
    this.codeTail = null;
  }

  syncMarks(marks: JMark[], nodes: J[], i: number) {
    let k = 0;
    while (k < this.stack.length && k < marks.length && sameMark(this.stack[k].mark, marks[k])) k++;
    while (this.stack.length > k) {
      const top = this.stack.pop()!;
      this.emit(top.close);
      if (top.close === ']') this.codeTail = 'call';
    }
    for (let m = k; m < marks.length; m++) {
      if (this.skipUntil > i) return;
      this.open(marks[m], m, nodes, i);
    }
  }

  /** Index nach dem letzten Knoten, der dieselben Markierungen bis Stufe `depth` trägt. */
  private spanEnd(nodes: J[], i: number, depth: number, mark: JMark): number {
    const base = (nodes[i].marks ?? []).slice(0, depth);
    let j = i;
    while (j < nodes.length) {
      const ms = nodes[j].marks ?? [];
      if (ms.length <= depth || !sameMark(ms[depth], mark) || !base.every((b, x) => sameMark(b, ms[x]))) break;
      j++;
    }
    return j;
  }

  private spanText(nodes: J[], i: number, j: number): string {
    return nodes
      .slice(i, j)
      .map((n) => (n.type === 'text' ? n.text : '￼'))
      .join('');
  }

  private open(mark: JMark, depth: number, nodes: J[], i: number) {
    const a = mark.attrs ?? {};
    const end = this.spanEnd(nodes, i, depth, mark);
    const text = this.spanText(nodes, i, end);
    const prevChar = this.out.slice(-1);
    const nextNode = nodes[end];
    const nextChar = nextNode ? (nextNode.type === 'text' ? nextNode.text![0] : '#') : '';
    this.guardCode(mark.type === 'bold' ? '*' : mark.type === 'italic' ? '_' : '#');

    switch (mark.type) {
      case 'link': {
        const href = String(a.href ?? '');
        const onlyLink = nodes.slice(i, end).every((n) => n.type === 'text' && (n.marks ?? []).length === depth + 1);
        if (onlyLink && text === href) {
          const bareOk =
            a.form === 'bare' &&
            URL_RE.test(href) &&
            !/[.,;:!?')]$/.test(href) &&
            (!nextChar || /[\s,;:!?)\]]/.test(nextChar)) &&
            !/[\w]/.test(prevChar);
          this.emit(bareOk ? href : `#link(${stringLiteral(href)})`);
          if (!bareOk) this.codeTail = 'call';
          this.atLineStart = false;
          this.skipUntil = end;
          return;
        }
        this.push(mark, `#link(${stringLiteral(href)})[`, ']');
        return;
      }
      case 'callMark':
        this.push(mark, `#${a.callee}${(a.args as string | null) ?? ''}[`, ']');
        return;
      case 'textStyle': {
        const args = [
          a.font ? `font: ${a.font}` : '',
          a.size ? `size: ${a.size}` : '',
          a.weight ? `weight: ${a.weight}` : '',
          a.fill ? `fill: ${a.fill}` : '',
          a.rest ? String(a.rest) : '',
        ].filter(Boolean);
        if (!args.length) {
          this.push(mark, '', '');
          return;
        }
        this.push(mark, `#text(${args.join(', ')})[`, ']');
        return;
      }
      case 'highlight':
        this.push(mark, a.fill ? `#highlight(fill: ${a.fill})[` : '#highlight[', ']');
        return;
      case 'underline':
        this.push(mark, '#underline[', ']');
        return;
      case 'strike':
        this.push(mark, '#strike[', ']');
        return;
      case 'smallcaps':
        this.push(mark, '#smallcaps[', ']');
        return;
      case 'superscript':
        this.push(mark, '#super[', ']');
        return;
      case 'subscript':
        this.push(mark, '#sub[', ']');
        return;
      case 'bold':
      case 'italic': {
        const delim = mark.type === 'bold' ? '*' : '_';
        const fn = mark.type === 'bold' ? 'strong' : 'emph';
        const shortOk =
          !/[\p{L}\p{N}\\]/u.test(prevChar) &&
          !/[\p{L}\p{N}]/u.test(nextChar ?? '') &&
          text.length > 0 &&
          !/^\s|\s$/.test(text) &&
          !text.includes('￼');
        if (shortOk) this.push(mark, delim, delim);
        else this.push(mark, `#${fn}[`, ']');
        return;
      }
      case 'code': {
        const onlyCode = nodes.slice(i, end).every((n) => n.type === 'text' && (n.marks ?? []).length === depth + 1);
        if (onlyCode) {
          this.emit(!text.includes('`') && text.length > 0 && !/^\s|\s$/.test(text) ? '`' + text + '`' : `#raw(${stringLiteral(text)})`);
          this.codeTail = text.includes('`') ? 'call' : null;
          this.atLineStart = false;
          this.skipUntil = end;
          return;
        }
        this.push(mark, '', '');
        return;
      }
      default:
        this.push(mark, '', '');
    }
  }

  private push(mark: JMark, open: string, close: string) {
    this.emit(open);
    if (open) this.atLineStart = false;
    this.stack.push({ mark, close });
  }

  content(n: J, next: J | undefined) {
    switch (n.type) {
      case 'text': {
        let t = escapeText((n.text ?? '').replace(/\n/g, ' '));
        if (this.atLineStart) t = escapeLineStart(t);
        if (this.out.endsWith(']') && /^(\.[\p{L}_]|[([])/u.test(t)) t = '\\' + t;
        this.guardCode(t);
        this.emit(t);
        if (t) this.atLineStart = false;
        break;
      }
      case 'hardBreak':
        this.codeTail = null;
        if (!next) {
          // Am Ende: kein Zeilenumbruch im Quelltext, sonst entstünde ein Absatzwechsel
          this.emit('\\ ');
          break;
        }
        this.emit('\\\n' + this.indent);
        this.atLineStart = true;
        break;
      case 'mathInline':
        this.guardCode('$');
        this.emit(String(n.attrs?.src ?? ''));
        this.atLineStart = false;
        break;
      case 'typstInline': {
        const src = String(n.attrs?.src ?? '');
        const kind = n.attrs?.kind;
        if (src.startsWith('#')) this.guardCode('#');
        else if (this.codeTail) this.guardCode(src);
        this.emit(src);
        this.atLineStart = false;
        if (kind === 'comment' && src.startsWith('//')) {
          this.emit('\n' + this.indent);
          this.atLineStart = true;
        } else if (src.startsWith('#') && !src.endsWith(';')) {
          this.codeTail = /[\w-]$/.test(src) && !/[)\]]$/.test(src) ? 'ident' : 'call';
        } else {
          // Referenzen und Labels enden von selbst; `;` wäre hier sichtbarer Text
          this.codeTail = null;
        }
        break;
      }
      default:
        break;
    }
  }
}

export function escapeText(t: string): string {
  return t
    .replace(/[\\*_`$#\[\]<@~]/g, '\\$&')
    .replace(/\/(?=[/*])/g, '\\/')
    .replace(/ /g, '~')
    .replace(/­/g, '-?');
}

function escapeLineStart(t: string): string {
  if (/^=+( |$)/.test(t)) return '\\' + t;
  if (/^[-+/]( |$)/.test(t)) return '\\' + t;
  const m = t.match(/^(\d+)\.( |$)/);
  if (m) return m[1] + '\\.' + t.slice(m[1].length + 1);
  return t;
}
