// Rundlauf-Tests mit echten Typst-Dateien:
// 1. Laden + Speichern ohne Änderung muss den Quelltext exakt erhalten.
// 2. Frisch geschrieben (ohne Original-Ausschnitte) muss Typst dieselben Seiten rendern.
//
// Aufruf: npx tsx tests/roundtrip.ts [datei.typ ...]
// Ohne Argumente laufen alle Dateien aus tests/fixtures und examples. Eigene Dateien
// (z. B. echte Projekte) einfach als Argumente übergeben.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getSchema } from '@tiptap/core';
import { schemaExtensions } from '../src/editor/schema';
import { loadDocument, saveDocument } from '../src/typst/document';
import { serializeTypst } from '../src/typst/serialize';
import { TypstParser } from '../electron/parser';
import { prepareOverlay } from '../electron/overlay';

const HOME = os.homedir();
const DEFAULT_FILES = ['tests/fixtures', 'examples'].flatMap((dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.typ'))
        .map((f) => path.resolve(dir, f))
    : [],
);

const files = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES).map((f) => path.resolve(f)).filter((f) => fs.existsSync(f));
const parser = new TypstParser(path.resolve('native/typst-parse/target/release/typst-parse'));
const schema = getSchema(schemaExtensions());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-test-'));

function compile(file: string, root: string, outDir: string): string[] | string {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  try {
    execFileSync('typst', ['compile', file, path.join(outDir, '{p}.svg'), '--root', root], { stdio: 'pipe' });
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 600);
  }
  return fs
    .readdirSync(outDir)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((f) => fs.readFileSync(path.join(outDir, f), 'utf8'));
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const line = a.slice(0, i).split('\n').length;
  return `Zeile ${line}:\n  original: ${JSON.stringify(a.slice(Math.max(0, i - 60), i + 80))}\n  ergebnis: ${JSON.stringify(b.slice(Math.max(0, i - 60), i + 80))}`;
}

function stats(doc: { content?: unknown[] }) {
  const counts: Record<string, number> = {};
  const walk = (n: { type: string; content?: unknown[] }) => {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
    for (const c of (n.content ?? []) as { type: string }[]) walk(c);
  };
  walk(doc as { type: string });
  return ['paragraph', 'heading', 'callBlock', 'typstBlock', 'typstInline', 'table', 'bulletList', 'orderedList']
    .map((k) => `${k}=${counts[k] ?? 0}`)
    .join(' ');
}

let failed = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const tree = await parser.parse(src);
  const loaded = loadDocument(schema, src, tree);
  const label = path.relative(HOME, file);

  const same = saveDocument(loaded.doc, loaded);
  if (same !== src) {
    failed++;
    console.log(`✗ ${label}: Rundlauf nicht identisch\n${firstDiff(src, same)}`);
    continue;
  }

  // Wurzel eine Ebene höher, damit Kapitel mit `../lib.typ` kompilieren
  const root = path.basename(path.dirname(file)) === 'kapitel' ? path.dirname(path.dirname(file)) : path.dirname(file);
  const fresh = serializeTypst(loaded.doc, loaded.lead, loaded.trail);
  const overlayDir = path.join(tmp, 'ov', String(files.indexOf(file)));
  const ov = prepareOverlay(overlayDir, root, file, new Map([[file, fresh]]));
  const a = compile(file, root, path.join(tmp, 'a'));
  const b = compile(ov.main, overlayDir, path.join(tmp, 'b'));
  if (typeof a === 'string') {
    console.log(`~ ${label}: Original kompiliert nicht, nur Rundlauf geprüft (${stats(loaded.doc)})`);
    continue;
  }
  if (typeof b === 'string') {
    failed++;
    fs.writeFileSync(path.join(tmp, `fresh-${path.basename(file)}`), fresh);
    console.log(`✗ ${label}: frisch geschrieben kompiliert nicht\n${b}\n  (${path.join(tmp, `fresh-${path.basename(file)}`)})`);
    continue;
  }
  const diffPages = a.map((p, i) => (p === b[i] ? null : i + 1)).filter((x) => x !== null);
  if (a.length !== b.length || diffPages.length) {
    failed++;
    fs.writeFileSync(path.join(tmp, `fresh-${path.basename(file)}`), fresh);
    console.log(
      `✗ ${label}: Ausgabe weicht ab (Seiten ${a.length} vs ${b.length}, verschieden: ${diffPages.slice(0, 8).join(', ')})\n  (${path.join(tmp, `fresh-${path.basename(file)}`)})`,
    );
    continue;
  }
  console.log(`✓ ${label}: identisch, ${a.length} Seiten gleich gerendert (${stats(loaded.doc)})`);
}
parser.dispose();
console.log(failed ? `\n${failed} Fehler` : '\nAlles grün');
process.exit(failed ? 1 : 0);
