import { useSyncExternalStore } from 'react';
import { getLang, subscribeLang, type Lang } from '../i18n';

/** Re-render when the UI language changes (needed for components outside the main tree, e.g. node views). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}
