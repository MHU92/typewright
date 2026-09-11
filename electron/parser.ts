// Langlebiger Prozess des Rust-Helfers `typst-parse` (eine JSON-Zeile pro Anfrage).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { RawCst } from '../src/typst/cst';

export class TypstParser {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (t: RawCst) => void; reject: (e: Error) => void }>();

  constructor(private binary: string) {}

  private ensure() {
    if (this.proc) return this.proc;
    const proc = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg: { id: number; tree?: RawCst; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.tree) w.resolve(msg.tree);
      else w.reject(new Error(msg.error ?? 'Parser-Fehler'));
    });
    proc.on('exit', () => {
      this.proc = null;
      for (const w of this.waiting.values()) w.reject(new Error('Parser beendet'));
      this.waiting.clear();
    });
    this.proc = proc;
    return proc;
  }

  parse(text: string, mode: 'markup' | 'code' = 'markup'): Promise<RawCst> {
    const proc = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ id, text, mode }) + '\n');
    });
  }

  dispose() {
    this.proc?.kill();
    this.proc = null;
  }
}
