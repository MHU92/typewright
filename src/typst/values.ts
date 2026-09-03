// Kleine Helfer für Typst-Werte (Farben, Längen, Strings), die der Editor anzeigen
// oder aus der Oberfläche heraus schreiben muss.

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  gray: '#aaaaaa',
  silver: '#dddddd',
  white: '#ffffff',
  navy: '#001f3f',
  blue: '#0074d9',
  aqua: '#7fdbff',
  teal: '#39cccc',
  eastern: '#239dad',
  purple: '#b10dc9',
  fuchsia: '#f012be',
  maroon: '#85144b',
  red: '#ff4136',
  orange: '#ff851b',
  yellow: '#ffdc00',
  olive: '#3d9970',
  green: '#2ecc40',
  lime: '#01ff70',
};

/** Variablen, deren Farbwert der Editor aus dem Dokument aufgelöst hat (z. B. `farbe.blau`). */
let resolvedColors: Record<string, string> = {};

export function setResolvedColors(map: Record<string, string>) {
  resolvedColors = map;
}

export function typstColorToCss(expr: string): string | null {
  const e = expr.trim();
  if (NAMED_COLORS[e]) return NAMED_COLORS[e];
  if (resolvedColors[e]) return resolvedColors[e];
  let m = e.match(/^rgb\(\s*"(#?[0-9a-fA-F]{3,8})"\s*\)$/);
  if (m) return m[1].startsWith('#') ? m[1] : `#${m[1]}`;
  m = e.match(/^rgb\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*(?:,\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    const ch = (v: string) => (v.endsWith('%') ? Math.round((parseFloat(v) / 100) * 255) : Math.round(parseFloat(v)));
    return `rgb(${ch(m[1])}, ${ch(m[2])}, ${ch(m[3])})`;
  }
  m = e.match(/^luma\(\s*([\d.]+%?)\s*\)$/);
  if (m) {
    const v = m[1].endsWith('%') ? Math.round((parseFloat(m[1]) / 100) * 255) : Math.round(parseFloat(m[1]));
    return `rgb(${v}, ${v}, ${v})`;
  }
  // z. B. `red.lighten(50%)`: Grundfarbe reicht für die Anzeige
  m = e.match(/^([a-z]+)\.(lighten|darken)\(/);
  if (m && NAMED_COLORS[m[1]]) return NAMED_COLORS[m[1]];
  return null;
}

export function cssHexToTypst(hex: string): string {
  return `rgb("${hex.toLowerCase()}")`;
}

/** Typst-Länge in Punkt umrechnen (nur absolute Einheiten). */
export function lengthToPt(expr: string | null | undefined): number | null {
  if (!expr) return null;
  const m = String(expr).trim().match(/^(-?[\d.]+)\s*(pt|mm|cm|in|em)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case 'mm':
      return (v * 72) / 25.4;
    case 'cm':
      return (v * 72) / 2.54;
    case 'in':
      return v * 72;
    case 'pt':
    case undefined:
      return v;
    default:
      return null;
  }
}

/** Liest einen Typst-String-Literal (`"..."`) aus; sonst null. */
export function readStringLiteral(expr: string): string | null {
  const e = expr.trim();
  if (!/^"(?:[^"\\]|\\.)*"$/.test(e)) return null;
  return e
    .slice(1, -1)
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[c] ?? c);
}

export function stringLiteral(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

export const PAPER_SIZES: Record<string, [number, number]> = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  a6: [105, 148],
  'us-letter': [215.9, 279.4],
  'us-legal': [215.9, 355.6],
  'presentation-16-9': [297, 167.0625],
  'presentation-4-3': [280, 210],
};
