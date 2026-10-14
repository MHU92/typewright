// User interface language. English is the default; German strings live in `de.ts`,
// keyed by the English text. Shared by the renderer and the Electron main process,
// so this module must not depend on React or the DOM.

import { DE } from './de';

export type Lang = 'en' | 'de';

let lang: Lang = 'en';
const listeners = new Set<() => void>();

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  for (const l of listeners) l();
}

export function getLang(): Lang {
  return lang;
}

/** Translate an English UI string; `{name}` placeholders are filled from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = lang === 'de' ? (DE[en] ?? en) : en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return s;
}

export function subscribeLang(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
