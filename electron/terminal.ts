// Eingebautes Terminal (für Claude Code): eine Login-Shell pro Fenster über node-pty.

import os from 'node:os';
import type { WebContents } from 'electron';
import * as pty from 'node-pty';

interface Session {
  id: number;
  proc: pty.IPty;
  owner: WebContents;
}

const sessions = new Map<number, Session>();
let nextId = 1;

function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    // Electron-, Entwicklungs- und Claude-Sitzungs-Variablen nicht weitergeben (sonst hält sich
    // Claude im Panel für eine Unter-Sitzung, z. B. wenn die App aus Claude Code gestartet wurde)
    if (/^(ELECTRON_|VITE_|TW_|NODE_OPTIONS$|CHROME_|CLAUDE_CODE_|CLAUDECODE$)/.test(k)) continue;
    env[k] = v;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'Typewright';
  // Aus dem Finder gestartete Apps haben oft keine Sprache gesetzt: UTF-8 erzwingen
  if (!env.LANG || !/UTF-8/i.test(env.LANG)) env.LANG = 'de_DE.UTF-8';
  return env;
}

/** Für die Shell sicher in einfache Anführungszeichen setzen. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function startTerminal(owner: WebContents, opts: { cwd: string; cols: number; rows: number; command: string | null }): number {
  const id = nextId++;
  const shell = os.userInfo().shell || process.env.SHELL || '/bin/zsh';
  // Mit Befehl: direkt ausführen (kein sichtbares Eintippen), danach eine normale Shell
  const args = opts.command ? ['-l', '-i', '-c', `${opts.command}; exec ${shellQuote(shell)} -l`] : ['-l'];
  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: Math.max(20, opts.cols),
    rows: Math.max(5, opts.rows),
    cwd: opts.cwd,
    env: shellEnv(),
  });
  sessions.set(id, { id, proc, owner });
  proc.onData((data) => {
    if (!owner.isDestroyed()) owner.send('term:data', id, data);
  });
  proc.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (!owner.isDestroyed()) owner.send('term:exit', id, exitCode);
  });
  owner.once('destroyed', () => killTerminal(id));
  return id;
}

export function writeTerminal(id: number, data: string) {
  sessions.get(id)?.proc.write(data);
}

export function resizeTerminal(id: number, cols: number, rows: number) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.proc.resize(Math.max(20, cols), Math.max(5, rows));
  } catch {
    /* Prozess bereits beendet */
  }
}

export function killTerminal(id: number) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try {
    s.proc.kill();
  } catch {
    /* schon weg */
  }
}

export function killAll() {
  for (const id of [...sessions.keys()]) killTerminal(id);
}
