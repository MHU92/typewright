// Schnittstelle zwischen Electron-Hauptprozess und Oberfläche (über preload).

import type { RawCst } from '../typst/cst';

export interface Diagnostic {
  severity: 'error' | 'warning';
  file: string;
  line: number;
  column: number;
  message: string;
  hints: string[];
}

export interface PreviewPage {
  url: string;
  width: number;
  height: number;
}

export interface PreviewResult {
  ok: boolean;
  pages: PreviewPage[];
  diagnostics: Diagnostic[];
  ms: number;
  /** Datei, die tatsächlich kompiliert wurde (bei Kapiteln die Hauptdatei). */
  main: string | null;
  /** Überschriften der Ausgabe: Inhalt (JSON), Seite, Höhe auf der Seite in pt. */
  headings: { body: unknown; page: number; y: number }[];
}

export interface SnippetResult {
  ok: boolean;
  pages: PreviewPage[];
  diagnostics: Diagnostic[];
  value: unknown;
  evalOk: boolean;
  evalDiagnostics: Diagnostic[];
  ms: number;
}

export interface ProjectInfo {
  file: string | null;
  main: string | null;
  root: string | null;
  mainText: string | null;
}

export interface Settings {
  /** User interface language (English by default). */
  language: 'en' | 'de';
  zoom: number;
  showPreview: boolean;
  showNav: boolean;
  showSource: boolean;
  showMarks: boolean;
  previewZoom: number;
  /** KI-Terminal sichtbar. */
  showClaude: boolean;
  /** Höhe (oben/unten angedockt) bzw. Breite (links/rechts) des KI-Terminals. */
  claudeHeight: number;
  agentWidth: number;
  agentDock: AgentDock;
  /** Welche KI im Terminal startet. */
  agent: AgentKind;
  /** Befehl bei `agent: 'custom'`. */
  customCommand: string;
  autoSave: boolean;
  inputsByFile: Record<string, Record<string, string>>;
  mainByFile: Record<string, string>;
  recent: string[];
}

export type AgentKind = 'claude' | 'codex' | 'custom';
export type AgentDock = 'bottom' | 'top' | 'left' | 'right';

export const AGENT_NAMES: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  custom: 'Terminal',
};

export type SaveResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  /** Die Datei wurde inzwischen von außen geändert; nichts geschrieben. */
  | { status: 'conflict'; diskText: string };

export interface InitInfo {
  path: string | null;
  text: string | null;
  settings: Settings;
  typstVersion: string | null;
  windowId: number;
}

export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'save-and-close'
  | 'export-pdf'
  | 'print'
  | 'undo'
  | 'redo'
  | 'find'
  | 'replace'
  | 'paste-typst'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'superscript'
  | 'subscript'
  | 'clear-format'
  | 'heading-0'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'bullet-list'
  | 'ordered-list'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'insert-image'
  | 'insert-table'
  | 'insert-link'
  | 'insert-footnote'
  | 'insert-math'
  | 'insert-pagebreak'
  | 'insert-toc'
  | 'insert-code'
  | 'insert-typst'
  | 'toggle-preview'
  | 'toggle-source'
  | 'toggle-nav'
  | 'toggle-marks'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'reveal'
  | 'document-info'
  | 'inputs'
  | 'toggle-claude'
  | 'send-to-claude';

export interface TwApi {
  init(): Promise<InitInfo>;
  open(): Promise<void>;
  openPath(path: string): Promise<void>;
  newWindow(): Promise<void>;
  save(text: string, saveAs: boolean, force?: boolean, base?: string | null): Promise<SaveResult>;
  setDirty(dirty: boolean): void;
  closeNow(): void;
  parse(text: string, mode?: 'markup' | 'code'): Promise<RawCst>;
  project(text: string): Promise<ProjectInfo>;
  preview(text: string): Promise<PreviewResult>;
  snippets(text: string, doc: string, evalExpr: string | null): Promise<SnippetResult>;
  exportPdf(text: string): Promise<string | null>;
  print(text: string): Promise<void>;
  fonts(): Promise<string[]>;
  pickImage(): Promise<string | null>;
  readFile(path: string): Promise<string | null>;
  /** Bild ins Dokument holen; liefert den Pfad relativ zum Dokument. */
  importImage(input: { path?: string; data?: ArrayBuffer; ext?: string }): Promise<string | null>;
  pathForFile(file: File): string;
  fileUrl(relOrAbs: string): string;
  reveal(): void;
  openExternal(url: string): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  setInputs(inputs: Record<string, string>): Promise<void>;
  setMainFile(main: string | null): Promise<void>;
  chooseMainFile(): Promise<string | null>;
  termStart(opts: { cols: number; rows: number; agent: AgentKind; command: string | null }): Promise<{ id: number; cwd: string }>;
  termWrite(id: number, data: string): void;
  termResize(id: number, cols: number, rows: number): void;
  termKill(id: number): void;
  /** Editor-Kontext für Claude Code (Datei, Gliederung, Cursor, Markierung). */
  claudeContext(text: string): void;
  onTermData(cb: (id: number, data: string) => void): () => void;
  onTermExit(cb: (id: number, code: number) => void): () => void;
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  onExternalChange(cb: (text: string) => void): () => void;
  onOpened(cb: (info: { path: string; text: string }) => void): () => void;
}

declare global {
  interface Window {
    tw: TwApi;
  }
}
