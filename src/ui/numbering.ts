// Überschriften-Nummerierung im Editor wie in Typst (`#set heading(numbering: "1.1")`)
// als CSS-Zähler nachbilden.

const STYLES: Record<string, string> = {
  '1': 'decimal',
  a: 'lower-alpha',
  A: 'upper-alpha',
  i: 'lower-roman',
  I: 'upper-roman',
};

const esc = (s: string) => JSON.stringify(s);

export function numberingCss(pattern: string | null): string {
  if (!pattern) return '';
  const tokens: { sym: string | null; text: string }[] = [];
  let buf = '';
  for (const ch of pattern) {
    if (STYLES[ch]) {
      tokens.push({ sym: null, text: buf });
      tokens.push({ sym: ch, text: '' });
      buf = '';
    } else buf += ch;
  }
  const suffix = buf;
  const syms = tokens.filter((t) => t.sym).map((t) => t.sym!);
  if (!syms.length) return '';
  // Präfix vor dem ersten Symbol, Trenner zwischen den Symbolen
  const texts = tokens.filter((t) => !t.sym).map((t) => t.text);
  const prefix = texts[0] ?? '';
  const seps = texts.slice(1);
  const lastSep = seps[seps.length - 1] ?? '.';
  const rules: string[] = ['.tw-page.numbered .tw-prose { counter-reset: h1 h2 h3 h4 h5 h6; }'];
  for (let level = 1; level <= 6; level++) {
    rules.push(`.tw-page.numbered .tw-prose h${level} { counter-increment: h${level}; ${level < 6 ? `counter-reset: ${Array.from({ length: 6 - level }, (_, i) => `h${level + i + 1}`).join(' ')};` : ''} }`);
    const parts: string[] = [esc(prefix)];
    for (let i = 0; i < level; i++) {
      const sym = syms[Math.min(i, syms.length - 1)];
      parts.push(`counter(h${i + 1}, ${STYLES[sym]})`);
      if (i < level - 1) parts.push(esc(seps[i] ?? lastSep));
    }
    parts.push(esc(suffix));
    rules.push(`.tw-page.numbered .tw-prose h${level}::before { content: ${parts.join(' ')}; margin-right: 0.5em; }`);
  }
  return rules.join('\n');
}
