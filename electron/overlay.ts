// Ungespeicherten Stand kompilieren, ohne die Datei anzufassen: ein Spiegelordner
// mit Symlinks auf alle Geschwister, nur die bearbeitete Datei liegt als Kopie darin.
// So funktionieren relative Importe und Bilder wie im Original.

import fs from 'node:fs';
import path from 'node:path';

export interface Overlay {
  dir: string;
  /** Pfad der Hauptdatei im Spiegelordner. */
  main: string;
}

function linkSiblings(realDir: string, mirrorDir: string, skip: string) {
  fs.mkdirSync(mirrorDir, { recursive: true });
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(realDir);
  } catch {
    return;
  }
  const existing = new Set(fs.readdirSync(mirrorDir));
  for (const name of entries) {
    if (name === skip || name.startsWith('.typewright')) continue;
    const target = path.join(mirrorDir, name);
    if (existing.has(name)) continue;
    try {
      fs.symlinkSync(path.join(realDir, name), target);
    } catch {
      // z. B. Rechte: Datei fehlt dann in der Vorschau
    }
  }
  // Verschwundene Einträge entfernen
  for (const name of existing) {
    if (name === skip) continue;
    if (!entries.includes(name)) {
      try {
        fs.rmSync(path.join(mirrorDir, name), { recursive: true, force: true });
      } catch {
        /* egal */
      }
    }
  }
}

/**
 * Legt (oder aktualisiert) den Spiegel an. `files` sind die ungespeicherten
 * Inhalte (absoluter Pfad → Text), `main` die zu kompilierende Datei.
 */
export function prepareOverlay(base: string, root: string, main: string, files: Map<string, string>): Overlay {
  // Symlinks brauchen absolute Ziele
  root = path.resolve(root);
  main = path.resolve(main);
  files = new Map([...files].map(([f, t]) => [path.resolve(f), t]));
  const touched = new Set<string>();
  for (const file of [main, ...files.keys()]) {
    const rel = path.relative(root, file);
    if (rel.startsWith('..')) continue;
    const segs = rel.split(path.sep);
    let real = root;
    let mirror = base;
    for (let i = 0; i < segs.length; i++) {
      const key = `${mirror}|${segs[i]}`;
      if (!touched.has(key)) {
        // Auf jeder Ebene nur den Ast, der zur Datei führt, als echten Ordner anlegen
        const branch = segs[i];
        const wasLink = fs.existsSync(path.join(mirror, branch)) && fs.lstatSync(path.join(mirror, branch)).isSymbolicLink();
        if (wasLink) fs.rmSync(path.join(mirror, branch));
        linkSiblings(real, mirror, branch);
        touched.add(key);
      }
      real = path.join(real, segs[i]);
      mirror = path.join(mirror, segs[i]);
    }
  }
  for (const [file, text] of files) {
    const rel = path.relative(root, file);
    if (rel.startsWith('..')) continue;
    const target = path.join(base, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== text) fs.writeFileSync(target, text);
  }
  const mainRel = path.relative(root, main);
  const mainTarget = path.join(base, mainRel);
  if (!files.has(main)) {
    // Die Hauptdatei muss eine echte Datei im Spiegel sein: Typst löst Symlinks
    // der Hauptdatei auf und meldet sie sonst als außerhalb der Wurzel
    const text = fs.readFileSync(main, 'utf8');
    const isLink = fs.existsSync(mainTarget) && fs.lstatSync(mainTarget).isSymbolicLink();
    if (isLink) fs.rmSync(mainTarget);
    const current = !isLink && fs.existsSync(mainTarget) ? fs.readFileSync(mainTarget, 'utf8') : null;
    if (current !== text) fs.writeFileSync(mainTarget, text);
  }
  return { dir: base, main: mainTarget };
}
