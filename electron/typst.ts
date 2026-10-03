// Aufrufe der Typst-CLI: Vorschau (SVG je Seite), Schnipsel, Auswertung, PDF.

import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '../src/i18n';

export interface Diagnostic {
  severity: 'error' | 'warning';
  file: string;
  line: number;
  column: number;
  message: string;
  hints: string[];
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  ms: number;
  diagnostics: Diagnostic[];
}

let typstBinary: string | null = null;

export function findTypst(override?: string | null): string | null {
  if (override && fs.existsSync(override)) return (typstBinary = override);
  if (typstBinary) return typstBinary;
  const candidates = [
    '/opt/homebrew/bin/typst',
    '/usr/local/bin/typst',
    path.join(os.homedir(), '.cargo/bin/typst'),
    '/usr/bin/typst',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return (typstBinary = c);
  try {
    const out = execFileSync('/bin/zsh', ['-lc', 'command -v typst'], { encoding: 'utf8', timeout: 4000 }).trim();
    if (out && fs.existsSync(out)) return (typstBinary = out);
  } catch {
    /* nicht gefunden */
  }
  return null;
}

export function typstVersion(): string | null {
  const bin = findTypst();
  if (!bin) return null;
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function parseDiagnostics(stderr: string, cwd: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of stderr.split('\n')) {
    const m = line.match(/^(.*?):(\d+):(\d+): (error|warning): (.*)$/);
    if (m) {
      out.push({
        file: path.resolve(cwd, m[1]),
        line: parseInt(m[2], 10),
        column: parseInt(m[3], 10),
        severity: m[4] as 'error' | 'warning',
        message: m[5],
        hints: [],
      });
      continue;
    }
    const h = line.match(/^\s*(?:=\s*)?hint: (.*)$/);
    if (h && out.length) out[out.length - 1].hints.push(h[1]);
    else if (/^error: /.test(line)) {
      out.push({ file: '', line: 0, column: 0, severity: 'error', message: line.replace(/^error: /, ''), hints: [] });
    }
  }
  return out;
}

export function runTypst(args: string[], cwd: string, timeoutMs = 60000): Promise<RunResult> {
  const bin = findTypst();
  const started = Date.now();
  if (!bin) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: t('Typst was not found. Install it with: brew install typst'),
      ms: 0,
      diagnostics: [
        { severity: 'error', file: '', line: 0, column: 0, message: t('Typst CLI not found (brew install typst)'), hints: [] },
      ],
    });
  }
  return new Promise((resolve) => {
    const withDiag = args[0] === 'compile' || args[0] === 'eval' || args[0] === 'query';
    execFile(
      bin,
      withDiag ? [...args, '--diagnostic-format', 'short'] : args,
      { cwd, timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          ms: Date.now() - started,
          diagnostics: parseDiagnostics(String(stderr ?? ''), cwd),
        });
      },
    );
  });
}

export function inputArgs(inputs: Record<string, string>): string[] {
  return Object.entries(inputs).flatMap(([k, v]) => ['--input', `${k}=${v}`]);
}

export interface PageFile {
  /** Dateiname = Inhalts-Hash; unveränderte Seiten behalten ihre URL. */
  name: string;
  width: number;
  height: number;
}

/** Kompiliert nach SVG je Seite und legt die Seiten inhaltsadressiert in `pagesDir` ab. */
export async function compileSvgPages(
  file: string,
  root: string,
  pagesDir: string,
  extraArgs: string[],
): Promise<RunResult & { pages: PageFile[] }> {
  const runDir = path.join(pagesDir, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(runDir, { recursive: true });
  const res = await runTypst(
    ['compile', file, path.join(runDir, '{0p}.svg'), '--root', root, '--format', 'svg', ...extraArgs],
    path.dirname(file),
  );
  const pages: PageFile[] = [];
  if (res.ok) {
    const names = fs.readdirSync(runDir).filter((n) => n.endsWith('.svg')).sort();
    for (const n of names) {
      const full = path.join(runDir, n);
      const data = fs.readFileSync(full);
      const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 16);
      const name = `${hash}.svg`;
      const target = path.join(pagesDir, name);
      if (!fs.existsSync(target)) fs.renameSync(full, target);
      const head = data.subarray(0, 400).toString('utf8');
      const vb = head.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/);
      pages.push({ name, width: vb ? parseFloat(vb[1]) : 595.28, height: vb ? parseFloat(vb[2]) : 841.89 });
    }
  }
  fs.rmSync(runDir, { recursive: true, force: true });
  return { ...res, pages };
}

/** Alte Seitendateien löschen, die keine der letzten Vorschauen mehr braucht. */
export function gcPages(pagesDir: string, keep: Set<string>) {
  try {
    for (const n of fs.readdirSync(pagesDir)) {
      if (n.endsWith('.svg') && !keep.has(n)) fs.rmSync(path.join(pagesDir, n), { force: true });
    }
  } catch {
    /* egal */
  }
}

export async function evalInDocument(file: string, root: string, expr: string, extraArgs: string[]): Promise<RunResult & { value: unknown }> {
  const res = await runTypst(['eval', expr, '--in', file, '--root', root, ...extraArgs], path.dirname(file));
  let value: unknown = null;
  if (res.ok) {
    try {
      value = JSON.parse(res.stdout);
    } catch {
      value = null;
    }
  }
  return { ...res, value };
}

export async function listFonts(): Promise<string[]> {
  const res = await runTypst(['fonts'], os.homedir());
  if (!res.ok) return [];
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
