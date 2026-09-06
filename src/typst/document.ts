// Laden und Speichern eines Typst-Dokuments über das Editor-Schema.

import type { Schema } from '@tiptap/pm/model';
import type { RawCst } from './cst';
import { parseTypst, type J } from './parse';
import { blockKey, serializeTypst, type PreserveMap, type SerializeOptions } from './serialize';

export interface LoadedDocument {
  doc: J;
  lead: string;
  trail: string;
  preserve: PreserveMap;
}

/** JSON durch das Schema schicken: Standard-Attribute ergänzen, Markierungen sortieren. */
export function normalize(schema: Schema, json: J): J {
  return schema.nodeFromJSON(json).toJSON() as J;
}

export function loadDocument(schema: Schema, src: string, tree: RawCst): LoadedDocument {
  const parsed = parseTypst(src, tree);
  const preserve: PreserveMap = new Map();
  for (const rec of parsed.records) {
    try {
      const key = blockKey(normalize(schema, rec.json));
      if (!preserve.has(key)) preserve.set(key, { src: rec.src, indent: rec.indent });
    } catch {
      // Block passt nicht ins Schema: wird dann frisch geschrieben
    }
  }
  return { doc: normalize(schema, parsed.doc), lead: parsed.lead, trail: parsed.trail, preserve };
}

export function saveDocument(doc: J, loaded: Pick<LoadedDocument, 'lead' | 'trail' | 'preserve'>, options: SerializeOptions = {}): string {
  return serializeTypst(doc, loaded.lead, loaded.trail, { ...options, preserve: loaded.preserve });
}
