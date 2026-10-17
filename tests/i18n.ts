// Checks that every UI string passed to t()/tr() has a German translation in src/de.ts.
// Run: npx tsx tests/i18n.ts

import fs from 'node:fs';
import path from 'node:path';
import { DE } from '../src/de';

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && e.name !== 'de.ts' ? [p] : [];
  });
}

const call = /\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1).)*?)\1/gs;
const keys = new Set<string>();
for (const file of [...walk('src'), ...walk('electron')]) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(call)) keys.add(m[2].replace(/\\(['"\\])/g, '$1'));
}

const missing = [...keys].filter((k) => !(k in DE));
const unused = Object.keys(DE).filter((k) => !keys.has(k));
console.log(`${keys.size} strings, ${missing.length} missing in de.ts, ${unused.length} unused`);
for (const k of missing) console.log(`  missing: ${JSON.stringify(k)}`);
for (const k of unused) console.log(`  unused:  ${JSON.stringify(k)}`);
process.exit(missing.length ? 1 : 0);
