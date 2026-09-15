// Dokumentkontext für Node-Views (Pfad, Ordner), plus kleine UI-Brücke für Dialoge.

type Listener = () => void;

export interface DocContext {
  path: string | null;
  dir: string | null;
  /** Projektwurzel: Pfade wie "/bilder/x.png" beziehen sich in Typst darauf. */
  root: string | null;
  showMarks: boolean;
}

let ctx: DocContext = { path: null, dir: null, root: null, showMarks: false };
const listeners = new Set<Listener>();

export function setDocContext(patch: Partial<DocContext>) {
  ctx = { ...ctx, ...patch };
  for (const l of listeners) l();
}

export function getDocContext() {
  return ctx;
}

export function subscribeDocContext(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** URL für ein Bild aus dem Dokument (relativ zum Dokumentordner oder zur Wurzel). */
export function assetUrl(src: string): string | null {
  if (/^(https?:|data:)/.test(src)) return src;
  const dir = ctx.dir;
  if (!dir) return null;
  const abs = src.startsWith('/') ? normalize(`${ctx.root ?? dir}/${src}`) : normalize(`${dir}/${src}`);
  return window.tw.fileUrl(abs);
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return '/' + out.join('/');
}

// ------------------------------------------------------------------ Code-Dialog

export interface CodeEditRequest {
  title: string;
  code: string;
  hint?: string;
  language?: 'typst' | 'math';
  onSave: (code: string) => void;
  onDelete?: () => void;
}

let openCodeDialog: ((r: CodeEditRequest) => void) | null = null;

export function registerCodeDialog(fn: (r: CodeEditRequest) => void) {
  openCodeDialog = fn;
}

export function editCode(r: CodeEditRequest) {
  openCodeDialog?.(r);
}
