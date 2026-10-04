// Projektkontext einer Datei: Wurzelordner und Hauptdatei (bei Kapiteln, die per
// `#include` in eine andere Datei eingebunden sind).

import fs from 'node:fs';
import path from 'node:path';

export interface ProjectInfo {
  file: string;
  /** Datei, die für die Vorschau kompiliert wird (die Datei selbst oder ihre Hauptdatei). */
  main: string;
  root: string;
}

function readSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Sucht in diesem und den zwei Ordnern darüber eine .typ-Datei, die `file` per include einbindet. */
export function findMainFile(file: string): string | null {
  let dir = path.dirname(file);
  for (let depth = 0; depth < 3; depth++) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir).filter((n) => n.endsWith('.typ'));
    } catch {
      break;
    }
    // main.typ zuerst prüfen
    entries.sort((a, b) => (a === 'main.typ' ? -1 : b === 'main.typ' ? 1 : a.localeCompare(b)));
    for (const name of entries) {
      const candidate = path.join(dir, name);
      if (candidate === file) continue;
      const text = readSafe(candidate);
      if (!text || !text.includes('include')) continue;
      const rel = path.relative(dir, file).split(path.sep).join('/');
      const re = new RegExp(`include\\s*\\(?\\s*"(\\./)?${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
      if (re.test(text)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Benötigte Wurzel: höchster Ordner, auf den relative Pfade (`../`) in Importen zeigen. */
function requiredRoot(file: string, text: string, base: string): string {
  let root = base;
  const re = /(?:import|include|read|image|json|csv|yaml|toml|xml|cbor|plugin|bibliography)\s*\(?\s*"(\.\.\/[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const target = path.resolve(path.dirname(file), m[1]);
    let dir = path.dirname(target);
    while (!isInside(dir, root)) {
      const parent = path.dirname(root);
      if (parent === root) break;
      root = parent;
    }
    void dir;
  }
  return root;
}

/** Nächster Ordner mit `.git` oberhalb der Datei, sonst null. */
function gitRoot(file: string): string | null {
  let dir = path.dirname(file);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Pfade wie "/public/bild.svg" beziehen sich in Typst auf die Projektwurzel. */
function usesRootPaths(text: string): boolean {
  return /"\/[\w\-./]+\.(png|jpe?g|svg|gif|webp|typ|json|csv|ya?ml|toml|xml|pdf|bib)"/i.test(text);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function projectInfo(file: string, text: string, mainOverride?: string | null): ProjectInfo {
  const main = mainOverride && fs.existsSync(mainOverride) ? mainOverride : findMainFile(file) ?? file;
  let root = path.dirname(main);
  root = requiredRoot(file, text, root);
  const mainText = main !== file ? readSafe(main) : null;
  if (mainText) root = requiredRoot(main, mainText, root);
  if (usesRootPaths(text) || (mainText && usesRootPaths(mainText))) {
    const git = gitRoot(main);
    if (git && isInside(root, git)) root = git;
  }
  if (!isInside(file, root)) root = path.dirname(file);
  return { file, main, root };
}
