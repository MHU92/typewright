// Felder in eigenen Funktionen (`#entry("2024", "Titel", body: [...])`): Erkennung, Feldnamen
// und vor allem, dass eine Änderung im Quelltext nur genau die Stelle des Feldes ändert.
// Run: npx tsx tests/fields.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getSchema } from '@tiptap/core';
import { schemaExtensions } from '../src/editor/schema';
import { loadDocument, saveDocument, type LoadedDocument } from '../src/typst/document';
import type { J } from '../src/typst/parse';
import { TypstParser } from '../electron/parser';

const parser = new TypstParser(path.resolve('native/typst-parse/target/release/typst-parse'));
const schema = getSchema(schemaExtensions());
const fixture = path.resolve('tests/fixtures/fields.typ');
const src = fs.readFileSync(fixture, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-fields-'));

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `\n    ${detail}`}`);
  if (!ok) failed++;
}

/** Zeilen, die nur in `a` bzw. nur in `b` stehen (für kleine, lokale Änderungen ausreichend). */
function changedLines(a: string, b: string) {
  const A = a.split('\n');
  const B = b.split('\n');
  return { removed: A.filter((l) => !B.includes(l)), added: B.filter((l) => !A.includes(l)) };
}

function compiles(text: string): boolean {
  const file = path.join(tmp, 'check.typ');
  fs.writeFileSync(file, text);
  try {
    execFileSync('typst', ['compile', file, path.join(tmp, 'check.pdf')], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const calls = (doc: J) => (doc.content ?? []).filter((b) => b.type === 'callFields');
const clone = (doc: J): J => JSON.parse(JSON.stringify(doc));
const save = (doc: J, loaded: LoadedDocument) => saveDocument(doc, loaded);

const loaded = loadDocument(schema, src, await parser.parse(src));
const doc = loaded.doc;

// ---------------------------------------------------------------- Erkennung

const found = calls(doc).map((c) => `${c.attrs!.callee}(${(c.content ?? []).map((f) => f.attrs!.label ?? '·').join(',')})`);
check(
  'eigene Funktionen werden zu Feldern, mit Namen aus der Definition',
  JSON.stringify(found) ===
    JSON.stringify(['section(title)', 'entry(when,title,org,body)', 'entry(when,title,org)', 'facts(items 1,·,items 2,·)', 'person(name,role)']),
  JSON.stringify(found),
);
check(
  '`#note(kind: …)[…]` (nur benannte Argumente plus Inhalt) bleibt ein callBlock',
  (doc.content ?? []).some((b) => b.type === 'callBlock' && b.attrs?.callee === 'note'),
);
check('unverändert gespeichert ist Zeichen für Zeichen gleich', save(doc, loaded) === src);

// ---------------------------------------------------------------- Bearbeiten

function editField(callIndex: number, label: string | null, fieldIndex: number, edit: (f: J) => void): string {
  const next = clone(doc);
  const call = calls(next)[callIndex];
  const fields = (call.content ?? []).filter((f) => label === null || f.attrs?.label === label);
  edit(fields[fieldIndex]);
  return save(next, loaded);
}

{
  const out = editField(2, 'title', 0, (f) => (f.content = [{ type: 'text', text: 'Master "Wirtschaftsinformatik"' }]));
  const d = changedLines(src, out);
  check(
    'String-Feld ändern: genau eine Zeile, Anführungszeichen escapt',
    d.removed.length === 1 && d.added.join('') === '#entry("2021", "Master \\"Wirtschaftsinformatik\\"", "Hochschule", body: none)',
    JSON.stringify(d),
  );
  check('… und das Ergebnis kompiliert', compiles(out));
}

{
  const out = editField(3, null, 2, (f) => (f.content = [{ type: 'text', text: '−80 Min.' }]));
  const d = changedLines(src, out);
  check(
    'String in einem Array ändern: geschütztes Leerzeichen bleibt als \\u{a0} lesbar',
    d.added.join('') === '  ("−80\\u{a0}Min.", [je Tag]),' && d.removed.length === 1,
    JSON.stringify(d),
  );
}

{
  const out = editField(1, 'body', 0, (f) => {
    const list = f.content![0];
    const item = clone(list.content![0]);
    item.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Neuer Punkt mit *Stern*' }] }];
    list.content!.splice(1, 0, item);
  });
  const d = changedLines(src, out);
  check(
    'Listenpunkt im Inhaltsfeld ergänzen: eine neue Zeile, richtig eingerückt, Rest unverändert',
    d.removed.length === 0 && d.added.join('') === '    - Neuer Punkt mit \\*Stern\\*',
    JSON.stringify(d),
  );
  check('… und das Ergebnis kompiliert', compiles(out));
}

{
  const out = editField(4, 'role', 0, (f) => (f.content = [{ type: 'text', text: 'Mathematikerin' }]));
  check('Wert in einem Dictionary ändern', out.includes('#person((name: "Ada", role: "Mathematikerin"))') && compiles(out));
}

{
  // Ein Feld verschwindet (z. B. durch Löschen über Feldgrenzen hinweg): der Aufruf bleibt gültig
  const next = clone(doc);
  const call = calls(next)[1];
  call.content = (call.content ?? []).filter((f) => f.attrs?.label !== 'org');
  const out = save(next, loaded);
  check('fehlendes Feld wird als leerer Inhalt geschrieben, der Aufruf bleibt gültig', out.includes('  [],\n  body: [') && compiles(out));
}

parser.dispose();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} Fehler` : '\nAlles grün');
process.exit(failed ? 1 : 0);
