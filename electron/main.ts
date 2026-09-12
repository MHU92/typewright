// Electron-Hauptprozess: Fenster (eins pro Dokument), Menüs, Dateien, Typst-Aufrufe.

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, net, protocol, shell, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TypstParser } from './parser';
import { prepareOverlay } from './overlay';
import { projectInfo } from './project';
import { compileSvgPages, evalInDocument, findTypst, gcPages, inputArgs, listFonts, runTypst, typstVersion, type Diagnostic } from './typst';
import { killAll, killTerminal, resizeTerminal, startTerminal, writeTerminal } from './terminal';
import { prepareClaude, prepareCodex, writeContext } from './claude';
// Some handlers have a local `t` (compile target); they use the alias `tr` for translations
import { setLang, t, t as tr } from '../src/i18n';
import type { AgentKind, MenuCommand, PreviewResult, SaveResult, Settings, SnippetResult } from '../src/shared/api';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const appRoot = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'typewright');

// Selbsttests dürfen die echten Einstellungen (zuletzt geöffnet usw.) nicht verändern
if (process.env.TW_AUTOTEST) app.setPath('userData', path.join(os.tmpdir(), 'typewright-autotest'));

protocol.registerSchemesAsPrivileged([
  { scheme: 'tw', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ------------------------------------------------------------------ Einstellungen

const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  zoom: 1,
  showPreview: true,
  showNav: true,
  showSource: false,
  showMarks: false,
  previewZoom: 0.5,
  showClaude: false,
  claudeHeight: 320,
  agentWidth: 560,
  agentDock: 'bottom',
  agent: 'claude',
  customCommand: '',
  autoSave: false,
  inputsByFile: {},
  mainByFile: {},
  recent: [],
};

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

let settings: Settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  setLang(settings.language === 'de' ? 'de' : 'en');
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {
    /* nicht kritisch */
  }
}

function addRecent(file: string) {
  settings.recent = [file, ...settings.recent.filter((f) => f !== file)].slice(0, 15);
  saveSettings();
  app.addRecentDocument(file);
  buildMenu();
}

// ------------------------------------------------------------------ Fenster

interface DocWindow {
  id: number;
  win: BrowserWindow;
  path: string | null;
  dirty: boolean;
  /** Zuletzt bekannter Inhalt auf der Platte (um eigene Speicherungen zu erkennen). */
  diskText: string | null;
  watcher: fs.FSWatcher | null;
  watchTimer: NodeJS.Timeout | null;
  tmp: string;
  previewKeep: string[][];
  snippetKeep: string[][];
  allowClose: boolean;
  /** Projektwurzel der letzten Kompilierung (für Bilder im Editor). */
  root: string | null;
}

const docs = new Map<number, DocWindow>();
let windowCounter = 0;
let parser: TypstParser;
let fontCache: string[] | null = null;
const pendingOpen: string[] = [];

function docFor(sender: Electron.WebContents): DocWindow {
  const d = [...docs.values()].find((x) => x.win.webContents.id === sender.id);
  if (!d) throw new Error('Fenster unbekannt');
  return d;
}

function focusedDoc(): DocWindow | null {
  const w = BrowserWindow.getFocusedWindow();
  if (!w) return null;
  return [...docs.values()].find((d) => d.win === w) ?? null;
}

function updateTitle(d: DocWindow) {
  const name = d.path ? path.basename(d.path) : t('Untitled');
  d.win.setTitle(name);
  if (d.path) d.win.setRepresentedFilename(d.path);
  d.win.setDocumentEdited(d.dirty);
}

function watch(d: DocWindow) {
  d.watcher?.close();
  d.watcher = null;
  if (!d.path) return;
  const dir = path.dirname(d.path);
  const base = path.basename(d.path);
  try {
    d.watcher = fs.watch(dir, (_event, name) => {
      if (name && name !== base) return;
      if (d.watchTimer) clearTimeout(d.watchTimer);
      d.watchTimer = setTimeout(() => {
        if (!d.path) return;
        let text: string;
        try {
          text = fs.readFileSync(d.path, 'utf8');
        } catch {
          return;
        }
        if (text === d.diskText) return;
        d.diskText = text;
        d.win.webContents.send('file:external', text);
      }, 120);
    });
  } catch {
    d.watcher = null;
  }
}

function createWindow(file: string | null = null): DocWindow {
  const id = ++windowCounter;
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#f3f2f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      spellcheck: true,
    },
  });
  const tmp = path.join(TMP, `${process.pid}-${id}`);
  fs.mkdirSync(tmp, { recursive: true });
  const d: DocWindow = {
    id,
    win,
    path: file,
    dirty: false,
    diskText: null,
    watcher: null,
    watchTimer: null,
    tmp,
    previewKeep: [],
    snippetKeep: [],
    allowClose: false,
    root: null,
  };
  if (file) {
    try {
      d.diskText = fs.readFileSync(file, 'utf8');
    } catch {
      d.diskText = null;
    }
    addRecent(file);
  }
  docs.set(id, d);
  updateTitle(d);
  watch(d);

  win.webContents.session.setSpellCheckerLanguages?.(['de-DE', 'en-US']);
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (d.allowClose || !d.dirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: t('Save changes to “{file}”?', { file: d.path ? path.basename(d.path) : t('Untitled') }),
      detail: t('Your changes will be lost if you don’t save them.'),
      buttons: [t('Save'), t('Don’t Save'), t('Cancel')],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) win.webContents.send('menu', 'save-and-close');
    else if (choice === 1) {
      d.allowClose = true;
      win.close();
    }
  });
  win.on('closed', () => {
    d.watcher?.close();
    docs.delete(id);
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  });
  win.webContents.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 6)) {
        items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: t('No Guesses Found'), enabled: false });
      items.push({
        label: t('Learn Spelling'),
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable || params.selectionText) {
      items.push({ role: 'cut', label: t('Cut'), enabled: params.editFlags.canCut });
      items.push({ role: 'copy', label: t('Copy'), enabled: params.editFlags.canCopy });
      items.push({ role: 'paste', label: t('Paste'), enabled: params.editFlags.canPaste });
      items.push({ type: 'separator' });
      items.push({ role: 'selectAll', label: t('Select All') });
    }
    if (params.linkURL && /^https?:/.test(params.linkURL)) {
      items.push({ type: 'separator' });
      items.push({ label: t('Open Link in Browser'), click: () => shell.openExternal(params.linkURL) });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else win.loadFile(path.join(appRoot, 'dist', 'index.html'));

  if (process.env.TW_AUTOTEST) runAutotest(win);
  return d;
}

/** Für Selbsttests: Skript im Fenster ausführen, Screenshot speichern, beenden. */
function runAutotest(win: BrowserWindow) {
  win.webContents.once('did-finish-load', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(Number(process.env.TW_WAIT ?? 3500));
    try {
      const script = fs.readFileSync(process.env.TW_AUTOTEST!, 'utf8');
      const result = await win.webContents.executeJavaScript(script, true);
      if (result !== undefined) console.log('[autotest]', typeof result === 'string' ? result : JSON.stringify(result));
    } catch (e) {
      console.log('[autotest] Fehler', e);
    }
    await wait(Number(process.env.TW_WAIT_AFTER ?? 1500));
    if (process.env.TW_SCREENSHOT) {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.TW_SCREENSHOT, img.toPNG());
    }
    if (!process.env.TW_KEEP_OPEN) app.exit(0);
  });
}

function isPristine(d: DocWindow) {
  return !d.path && !d.dirty;
}

function openPath(file: string, preferWindow?: DocWindow | null) {
  const abs = path.resolve(file);
  const existing = [...docs.values()].find((d) => d.path === abs);
  if (existing) {
    existing.win.focus();
    return;
  }
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    dialog.showErrorBox(t('The file could not be opened'), String(e));
    return;
  }
  const target = preferWindow && isPristine(preferWindow) ? preferWindow : null;
  if (target) {
    target.path = abs;
    target.diskText = text;
    target.dirty = false;
    updateTitle(target);
    watch(target);
    addRecent(abs);
    target.win.webContents.send('doc:opened', { path: abs, text });
  } else createWindow(abs);
}

async function showOpenDialog(from: DocWindow | null) {
  const res = await dialog.showOpenDialog(from?.win ?? (undefined as unknown as BrowserWindow), {
    title: t('Open Typst file'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Typst', extensions: ['typ'] },
      { name: t('All Files'), extensions: ['*'] },
    ],
  });
  if (res.canceled) return;
  for (const f of res.filePaths) openPath(f, from);
}

// ------------------------------------------------------------------ Menü

function send(cmd: MenuCommand) {
  const d = focusedDoc();
  if (d) d.win.webContents.send('menu', cmd);
  else if (cmd === 'new') createWindow();
  else if (cmd === 'open') void showOpenDialog(null);
}

/** Shortcuts the editor handles itself: show them in the menu, but do not capture them. */
const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false });

function buildMenu() {
  const recent: MenuItemConstructorOptions[] = settings.recent.length
    ? [
        ...settings.recent.map((f) => ({ label: f.replace(os.homedir(), '~'), click: () => openPath(f, focusedDoc()) })),
        { type: 'separator' as const },
        {
          label: t('Clear Menu'),
          click: () => {
            settings.recent = [];
            saveSettings();
            app.clearRecentDocuments();
            buildMenu();
          },
        },
      ]
    : [{ label: t('None'), enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: t('About {app}', { app: app.name }) },
        { type: 'separator' },
        { role: 'services', label: t('Services') },
        { type: 'separator' },
        { role: 'hide', label: t('Hide {app}', { app: app.name }) },
        { role: 'hideOthers', label: t('Hide Others') },
        { role: 'unhide', label: t('Show All') },
        { type: 'separator' },
        { role: 'quit', label: t('Quit {app}', { app: app.name }) },
      ],
    },
    {
      label: t('File'),
      submenu: [
        { label: t('New'), accelerator: 'Cmd+N', click: () => createWindow() },
        { label: t('Open …'), accelerator: 'Cmd+O', click: () => void showOpenDialog(focusedDoc()) },
        { label: t('Open Recent'), submenu: recent },
        { type: 'separator' },
        { label: t('Close'), accelerator: 'Cmd+W', role: 'close' },
        { label: t('Save'), accelerator: 'Cmd+S', click: () => send('save') },
        { label: t('Save As …'), accelerator: 'Shift+Cmd+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: t('Export as PDF …'), accelerator: 'Cmd+E', click: () => send('export-pdf') },
        { label: t('Print …'), accelerator: 'Cmd+P', click: () => send('print') },
        { type: 'separator' },
        { label: t('Show in Finder'), click: () => send('reveal') },
        { label: t('Document Info'), click: () => send('document-info') },
      ],
    },
    {
      label: t('Edit'),
      submenu: [
        { label: t('Undo'), ...shown('Cmd+Z'), click: () => send('undo') },
        { label: t('Redo'), ...shown('Shift+Cmd+Z'), click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut', label: t('Cut') },
        { role: 'copy', label: t('Copy') },
        { role: 'paste', label: t('Paste') },
        { label: t('Paste as Typst'), accelerator: 'Alt+Shift+Cmd+V', click: () => send('paste-typst') },
        { role: 'selectAll', label: t('Select All') },
        { type: 'separator' },
        { label: t('Send Selection to the AI'), accelerator: 'Cmd+L', click: () => send('send-to-claude') },
        { type: 'separator' },
        { label: t('Find …'), accelerator: 'Cmd+F', click: () => send('find') },
        { label: t('Replace …'), ...shown('Shift+Cmd+H'), click: () => send('replace') },
      ],
    },
    {
      label: t('Insert'),
      submenu: [
        { label: t('Picture …'), click: () => send('insert-image') },
        { label: t('Table'), click: () => send('insert-table') },
        { label: t('Link …'), ...shown('Cmd+K'), click: () => send('insert-link') },
        { label: t('Footnote'), ...shown('Alt+Cmd+F'), click: () => send('insert-footnote') },
        { label: t('Equation'), ...shown('Ctrl+Cmd+M'), click: () => send('insert-math') },
        { type: 'separator' },
        { label: t('Page Break'), ...shown('Cmd+Enter'), click: () => send('insert-pagebreak') },
        { label: t('Table of Contents'), click: () => send('insert-toc') },
        { label: t('Code Block'), click: () => send('insert-code') },
        { label: t('Typst Code'), click: () => send('insert-typst') },
      ],
    },
    {
      label: t('Format'),
      submenu: [
        { label: t('Bold'), ...shown('Cmd+B'), click: () => send('bold') },
        { label: t('Italic'), ...shown('Cmd+I'), click: () => send('italic') },
        { label: t('Underline'), ...shown('Cmd+U'), click: () => send('underline') },
        { label: t('Strikethrough'), ...shown('Shift+Cmd+X'), click: () => send('strike') },
        { label: t('Superscript'), ...shown('Cmd+.'), click: () => send('superscript') },
        { label: t('Subscript'), ...shown('Cmd+,'), click: () => send('subscript') },
        { label: t('Clear Formatting'), ...shown('Cmd+\\'), click: () => send('clear-format') },
        { type: 'separator' },
        { label: t('Normal'), ...shown('Alt+Cmd+0'), click: () => send('heading-0') },
        { label: t('Heading 1'), ...shown('Alt+Cmd+1'), click: () => send('heading-1') },
        { label: t('Heading 2'), ...shown('Alt+Cmd+2'), click: () => send('heading-2') },
        { label: t('Heading 3'), ...shown('Alt+Cmd+3'), click: () => send('heading-3') },
        { label: t('Heading 4'), ...shown('Alt+Cmd+4'), click: () => send('heading-4') },
        { type: 'separator' },
        { label: t('Bullets'), ...shown('Shift+Cmd+8'), click: () => send('bullet-list') },
        { label: t('Numbering'), ...shown('Shift+Cmd+7'), click: () => send('ordered-list') },
        { type: 'separator' },
        { label: t('Align Left'), ...shown('Shift+Cmd+L'), click: () => send('align-left') },
        { label: t('Center'), ...shown('Shift+Cmd+E'), click: () => send('align-center') },
        { label: t('Align Right'), ...shown('Shift+Cmd+R'), click: () => send('align-right') },
        { label: t('Justify'), ...shown('Shift+Cmd+J'), click: () => send('align-justify') },
      ],
    },
    {
      label: t('View'),
      submenu: [
        { label: t('Print Preview'), accelerator: 'Alt+Cmd+P', click: () => send('toggle-preview') },
        { label: t('Typst Source'), accelerator: 'Alt+Cmd+U', click: () => send('toggle-source') },
        { label: t('Navigation Pane'), accelerator: 'Alt+Cmd+N', click: () => send('toggle-nav') },
        { label: t('AI Terminal (Claude Code, Codex)'), accelerator: 'Cmd+J', click: () => send('toggle-claude') },
        { label: t('Show Structure'), accelerator: 'Cmd+8', click: () => send('toggle-marks') },
        { type: 'separator' },
        { label: t('Zoom In'), accelerator: 'Cmd+Plus', click: () => send('zoom-in') },
        { label: t('Zoom Out'), accelerator: 'Cmd+-', click: () => send('zoom-out') },
        { label: t('Actual Size'), accelerator: 'Cmd+0', click: () => send('zoom-reset') },
        { type: 'separator' },
        { label: t('Inputs (sys.inputs) …'), click: () => send('inputs') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Enter Full Screen') },
        ...(isDev || process.env.TW_DEVTOOLS ? [{ role: 'toggleDevTools' as const, label: t('Developer Tools') }] : []),
      ],
    },
    { role: 'windowMenu', label: t('Window') },
    {
      role: 'help',
      label: t('Help'),
      submenu: [
        { label: t('Typst Documentation'), click: () => shell.openExternal('https://typst.app/docs/') },
        { label: t('Typst Reference'), click: () => shell.openExternal('https://typst.app/docs/reference/') },
        { type: 'separator' },
        { label: t('Typewright on GitHub'), click: () => shell.openExternal('https://github.com/MHU92/typewright') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ Typst

function inputsFor(d: DocWindow): Record<string, string> {
  return (d.path && settings.inputsByFile[d.path]) || {};
}

interface Target {
  /** Datei im Spiegelordner, die kompiliert wird. */
  main: string;
  /** Ordner der bearbeiteten Datei im Spiegel. */
  fileDir: string;
  root: string;
  realRoot: string;
  realMain: string | null;
}

function prepareTarget(d: DocWindow, text: string): Target {
  if (!d.path) {
    const dir = path.join(d.tmp, 'untitled');
    fs.mkdirSync(dir, { recursive: true });
    const main = path.join(dir, 'unbenannt.typ');
    fs.writeFileSync(main, text);
    return { main, fileDir: dir, root: dir, realRoot: dir, realMain: null };
  }
  const info = projectInfo(d.path, text, settings.mainByFile[d.path] ?? null);
  d.root = info.root;
  const base = path.join(d.tmp, 'overlay');
  const ov = prepareOverlay(base, info.root, info.main, new Map([[d.path, text]]));
  const fileDir = path.join(base, path.relative(info.root, path.dirname(d.path)));
  return { main: ov.main, fileDir, root: base, realRoot: info.root, realMain: info.main };
}

function mapDiagnostics(diags: Diagnostic[], t: Target, d: DocWindow, snippetFile?: string): Diagnostic[] {
  return diags.map((g) => {
    let file = g.file;
    if (snippetFile && file === snippetFile) return { ...g, file: '<snippets>' };
    if (file.startsWith(t.root)) {
      const rel = path.relative(t.root, file);
      file = d.path ? path.join(t.realRoot, rel) : tr('Untitled');
    }
    return { ...g, file };
  });
}

function keepRecent(list: string[][], names: string[], max = 3) {
  list.push(names);
  while (list.length > max) list.shift();
  return new Set(list.flat());
}

// ------------------------------------------------------------------ IPC

function registerIpc() {
  ipcMain.handle('init', (e) => {
    const d = docFor(e.sender);
    let text: string | null = null;
    if (d.path) {
      try {
        text = fs.readFileSync(d.path, 'utf8');
        d.diskText = text;
      } catch {
        text = null;
      }
    }
    return { path: d.path, text, settings, typstVersion: typstVersion(), windowId: d.id };
  });

  ipcMain.handle('open', (e) => showOpenDialog(docFor(e.sender)));
  ipcMain.handle('open-path', (e, file: string) => openPath(file, docFor(e.sender)));
  ipcMain.handle('new-window', () => {
    createWindow();
  });

  // `base`: der Stand, auf dem die Änderungen im Editor beruhen (zuletzt geladen oder gesichert)
  ipcMain.handle('save', async (e, text: string, saveAs: boolean, force = false, base: string | null = null): Promise<SaveResult> => {
    const d = docFor(e.sender);
    let target = d.path;
    if (!target || saveAs) {
      const res = await dialog.showSaveDialog(d.win, {
        title: t('Save As'),
        defaultPath: d.path ?? path.join(app.getPath('documents'), `${t('Untitled')}.typ`),
        filters: [{ name: 'Typst', extensions: ['typ'] }],
      });
      if (res.canceled || !res.filePath) return { status: 'cancelled' };
      target = res.filePath.endsWith('.typ') ? res.filePath : `${res.filePath}.typ`;
    } else if (!force && base !== null) {
      // Hat jemand (z. B. Claude Code) die Datei seit diesem Stand geändert? Dann nicht überschreiben
      let onDisk: string | null = null;
      try {
        onDisk = fs.readFileSync(target, 'utf8');
      } catch {
        onDisk = null;
      }
      if (onDisk !== null && onDisk !== base && onDisk !== text) {
        d.diskText = onDisk;
        return { status: 'conflict', diskText: onDisk };
      }
    }
    d.diskText = text;
    fs.writeFileSync(target, text);
    if (target !== d.path) {
      d.path = target;
      watch(d);
      addRecent(target);
    }
    d.dirty = false;
    updateTitle(d);
    return { status: 'saved', path: target };
  });

  // ---------------------------------------------------------------- Terminal (Claude Code)

  ipcMain.handle('term:start', (e, opts: { cols: number; rows: number; agent: AgentKind; command: string | null }) => {
    const d = docFor(e.sender);
    const cwd = d.root ?? (d.path ? path.dirname(d.path) : os.homedir());
    let command: string | null;
    if (opts.agent === 'claude') command = prepareClaude(d.tmp, 'claude').command;
    else if (opts.agent === 'codex') command = prepareCodex(d.tmp, d.path);
    else command = opts.command?.trim() || null;
    const id = startTerminal(e.sender, { cols: opts.cols, rows: opts.rows, command, cwd });
    return { id, cwd };
  });
  // Aktueller Editor-Kontext für Claude (wird bei jeder Nachricht über den Hook mitgeschickt)
  ipcMain.on('claude:context', (e, text: string) => writeContext(docFor(e.sender).tmp, text));
  ipcMain.on('term:write', (_e, id: number, data: string) => writeTerminal(id, data));
  ipcMain.on('term:resize', (_e, id: number, cols: number, rows: number) => resizeTerminal(id, cols, rows));
  ipcMain.on('term:kill', (_e, id: number) => killTerminal(id));

  ipcMain.on('dirty', (e, dirty: boolean) => {
    const d = docFor(e.sender);
    d.dirty = dirty;
    updateTitle(d);
  });

  ipcMain.on('close-now', (e) => {
    const d = docFor(e.sender);
    d.allowClose = true;
    d.win.close();
  });

  ipcMain.handle('parse', (_e, text: string, mode: 'markup' | 'code' = 'markup') => parser.parse(text, mode));

  ipcMain.handle('project', (e, text: string) => {
    const d = docFor(e.sender);
    if (!d.path) return { file: null, main: null, root: null, mainText: null };
    const info = projectInfo(d.path, text, settings.mainByFile[d.path] ?? null);
    let mainText: string | null = null;
    if (info.main !== d.path) {
      try {
        mainText = fs.readFileSync(info.main, 'utf8');
      } catch {
        mainText = null;
      }
    }
    return { file: d.path, main: info.main, root: info.root, mainText };
  });

  ipcMain.handle('preview', async (e, text: string): Promise<PreviewResult> => {
    const d = docFor(e.sender);
    const t = prepareTarget(d, text);
    const pagesDir = path.join(d.tmp, 'pages');
    const args = inputArgs(inputsFor(d));
    // Überschriften mit Seite und Höhe: damit folgt die Vorschau dem Editor
    const headingExpr = 'query(heading).map(h => (h.body, h.location().page(), h.location().position().y.pt()))';
    const [res, heads] = await Promise.all([
      compileSvgPages(t.main, t.root, pagesDir, args),
      evalInDocument(t.main, t.root, headingExpr, args),
    ]);
    if (res.ok) gcPages(pagesDir, keepRecent(d.previewKeep, res.pages.map((p) => p.name)));
    return {
      ok: res.ok,
      pages: res.pages.map((p) => ({ url: `tw://preview/${d.id}/${p.name}`, width: p.width, height: p.height })),
      diagnostics: mapDiagnostics(res.diagnostics, t, d),
      ms: res.ms,
      main: t.realMain,
      headings: heads.ok && Array.isArray(heads.value) ? (heads.value as [unknown, number, number][]).map(([body, page, y]) => ({ body, page, y })) : [],
    };
  });

  ipcMain.handle('snippets', async (e, text: string, doc: string, evalExpr: string | null): Promise<SnippetResult> => {
    const d = docFor(e.sender);
    const t = prepareTarget(d, text);
    const file = path.join(t.fileDir, '.typewright-snippets.typ');
    fs.writeFileSync(file, doc);
    const dir = path.join(d.tmp, 'snippets');
    const args = inputArgs(inputsFor(d));
    const [svg, ev] = await Promise.all([
      compileSvgPages(file, t.root, dir, args),
      evalExpr ? evalInDocument(file, t.root, evalExpr, args) : Promise.resolve(null),
    ]);
    if (svg.ok) gcPages(dir, keepRecent(d.snippetKeep, svg.pages.map((p) => p.name)));
    return {
      ok: svg.ok,
      pages: svg.pages.map((p) => ({ url: `tw://snippet/${d.id}/${p.name}`, width: p.width, height: p.height })),
      diagnostics: mapDiagnostics(svg.diagnostics, t, d, file),
      value: ev?.value ?? null,
      evalOk: ev?.ok ?? false,
      evalDiagnostics: ev ? mapDiagnostics(ev.diagnostics, t, d, file) : [],
      ms: svg.ms,
    };
  });

  ipcMain.handle('export-pdf', async (e, text: string) => {
    const d = docFor(e.sender);
    const base = d.path ? path.basename(d.path, '.typ') : tr('Untitled');
    const res = await dialog.showSaveDialog(d.win, {
      title: tr('Export as PDF'),
      defaultPath: path.join(d.path ? path.dirname(d.path) : app.getPath('documents'), `${base}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    const t = prepareTarget(d, text);
    const out = await runTypst(['compile', t.main, res.filePath, '--root', t.root, ...inputArgs(inputsFor(d))], path.dirname(t.main));
    if (!out.ok) {
      dialog.showErrorBox(tr('PDF export failed'), out.stderr.slice(0, 2000));
      return null;
    }
    return res.filePath;
  });

  ipcMain.handle('print', async (e, text: string) => {
    const d = docFor(e.sender);
    const t = prepareTarget(d, text);
    const pdf = path.join(d.tmp, `${d.path ? path.basename(d.path, '.typ') : tr('Untitled')}.pdf`);
    const out = await runTypst(['compile', t.main, pdf, '--root', t.root, ...inputArgs(inputsFor(d))], path.dirname(t.main));
    if (!out.ok) {
      dialog.showErrorBox(tr('Printing is not possible'), out.stderr.slice(0, 2000));
      return;
    }
    // Drucken über die Vorschau-App: dort stimmen Seitengrößen und Farben exakt
    const { execFile } = await import('node:child_process');
    execFile('/usr/bin/open', ['-a', 'Preview', pdf]);
  });

  ipcMain.handle('fonts', async () => {
    if (!fontCache) fontCache = await listFonts();
    return fontCache;
  });

  ipcMain.handle('pick-image', async (e) => {
    const d = docFor(e.sender);
    if (!d.path) {
      dialog.showMessageBoxSync(d.win, {
        type: 'info',
        message: t('Please save the document first'),
        detail: t('Pictures are referenced relative to where the document is saved.'),
      });
      return null;
    }
    const res = await dialog.showOpenDialog(d.win, {
      title: t('Insert picture'),
      properties: ['openFile'],
      filters: [{ name: t('Pictures'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    let src = res.filePaths[0];
    const info = projectInfo(d.path, d.diskText ?? '', settings.mainByFile[d.path] ?? null);
    if (path.relative(info.root, src).startsWith('..')) {
      // Außerhalb des Projekts: neben das Dokument kopieren, sonst findet Typst es nicht
      const target = path.join(path.dirname(d.path), path.basename(src));
      if (!fs.existsSync(target)) fs.copyFileSync(src, target);
      src = target;
    }
    return path.relative(path.dirname(d.path), src).split(path.sep).join('/');
  });

  // Bild aus der Zwischenablage (Daten) oder per Drag & Drop (Pfad) ins Dokument holen
  ipcMain.handle('import-image', (e, input: { path?: string; data?: ArrayBuffer; ext?: string }) => {
    const d = docFor(e.sender);
    if (!d.path) {
      dialog.showMessageBoxSync(d.win, {
        type: 'info',
        message: t('Please save the document first'),
        detail: t('Pictures are stored next to the document and referenced relative to it.'),
      });
      return null;
    }
    const docDir = path.dirname(d.path);
    let src: string;
    if (input.data) {
      const dir = path.join(docDir, 'bilder');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const ext = (input.ext ?? 'png').replace(/[^a-z0-9]/gi, '') || 'png';
      let target = path.join(dir, `eingefuegt-${stamp}.${ext}`);
      for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `eingefuegt-${stamp}-${i}.${ext}`);
      fs.writeFileSync(target, Buffer.from(input.data));
      src = target;
    } else if (input.path && fs.existsSync(input.path)) {
      src = input.path;
      const info = projectInfo(d.path, d.diskText ?? '', settings.mainByFile[d.path] ?? null);
      if (path.relative(info.root, src).startsWith('..')) {
        const target = path.join(docDir, path.basename(src));
        if (!fs.existsSync(target)) fs.copyFileSync(src, target);
        src = target;
      }
    } else return null;
    return path.relative(docDir, src).split(path.sep).join('/');
  });

  ipcMain.handle('read-file', (_e, file: string) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.on('reveal', (e) => {
    const d = docFor(e.sender);
    if (d.path) shell.showItemInFolder(d.path);
  });

  ipcMain.on('open-external', (_e, url: string) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    saveSettings();
    if (patch.language) {
      // The menu bar lives in the main process: rebuild it in the new language
      setLang(patch.language);
      buildMenu();
    }
    return settings;
  });
  ipcMain.handle('set-inputs', (e, inputs: Record<string, string>) => {
    const d = docFor(e.sender);
    if (!d.path) return;
    settings.inputsByFile = { ...settings.inputsByFile, [d.path]: inputs };
    saveSettings();
  });
  ipcMain.handle('set-main', (e, main: string | null) => {
    const d = docFor(e.sender);
    if (!d.path) return;
    const next = { ...settings.mainByFile };
    if (main) next[d.path] = main;
    else delete next[d.path];
    settings.mainByFile = next;
    saveSettings();
  });
  ipcMain.handle('choose-main', async (e) => {
    const d = docFor(e.sender);
    const res = await dialog.showOpenDialog(d.win, {
      title: t('Choose the main file for the preview'),
      defaultPath: d.path ? path.dirname(d.path) : undefined,
      properties: ['openFile'],
      filters: [{ name: 'Typst', extensions: ['typ'] }],
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });
}

// ------------------------------------------------------------------ Protokoll für Vorschau und Bilder

function registerProtocol() {
  protocol.handle('tw', async (req) => {
    const url = new URL(req.url);
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    let file: string | null = null;
    if (url.hostname === 'preview' || url.hostname === 'snippet') {
      const d = docs.get(Number(parts[0]));
      if (d && /^[\w.-]+\.svg$/.test(parts[1] ?? '')) file = path.join(d.tmp, url.hostname === 'preview' ? 'pages' : 'snippets', parts[1]);
    } else if (url.hostname === 'file') {
      const abs = '/' + parts.join('/');
      // Nur Dateien in der Nähe offener Dokumente ausliefern
      const inside = (dir: string) => !path.relative(dir, abs).startsWith('..');
      const allowed = [...docs.values()].some((d) => d.path && (inside(path.dirname(path.dirname(d.path))) || (d.root !== null && inside(d.root))));
      if (allowed) file = abs;
    }
    if (!file || !fs.existsSync(file)) return new Response('nicht gefunden', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ------------------------------------------------------------------ Start

app.setName('Typewright');
app.setAboutPanelOptions({
  applicationName: 'Typewright',
  applicationVersion: app.getVersion(),
  credits: 'A word processor for Typst.\nBuilt on Typst (typst.app) – thank you to the Typst team and community.',
  website: 'https://github.com/MHU92/typewright',
});

app.on('open-file', (e, file) => {
  e.preventDefault();
  if (app.isReady()) openPath(file, focusedDoc());
  else pendingOpen.push(file);
});

const gotLock = process.env.TW_AUTOTEST ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const files = argv.filter((a) => a.endsWith('.typ') && fs.existsSync(a));
    for (const f of files) openPath(f, focusedDoc());
    if (!files.length) createWindow();
  });

  app.whenReady().then(() => {
    loadSettings();
    parser = new TypstParser(
      app.isPackaged ? path.join(process.resourcesPath, 'typst-parse') : path.join(appRoot, 'native/typst-parse/target/release/typst-parse'),
    );
    findTypst();
    registerProtocol();
    registerIpc();
    buildMenu();
    if (process.platform === 'darwin') {
      const icon = path.join(appRoot, 'build', 'icon.png');
      if (fs.existsSync(icon)) app.dock?.setIcon(nativeImage.createFromPath(icon));
    }
    const argvFiles = process.argv.slice(1).filter((a) => a.endsWith('.typ') && fs.existsSync(a));
    const files = [...pendingOpen, ...argvFiles];
    if (files.length) for (const f of files) openPath(f, null);
    else createWindow();
  });

  app.on('activate', () => {
    if (!docs.size) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    parser?.dispose();
    killAll();
  });
}
