import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MenuCommand, TwApi } from '../src/shared/api';

const listen = <T>(channel: string, cb: (v: T) => void) => {
  const handler = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const api: TwApi = {
  init: () => ipcRenderer.invoke('init'),
  open: () => ipcRenderer.invoke('open'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  newWindow: () => ipcRenderer.invoke('new-window'),
  save: (text, saveAs, force = false, base = null) => ipcRenderer.invoke('save', text, saveAs, force, base),
  setDirty: (dirty) => ipcRenderer.send('dirty', dirty),
  closeNow: () => ipcRenderer.send('close-now'),
  parse: (text, mode = 'markup') => ipcRenderer.invoke('parse', text, mode),
  project: (text) => ipcRenderer.invoke('project', text),
  preview: (text) => ipcRenderer.invoke('preview', text),
  snippets: (text, doc, evalExpr) => ipcRenderer.invoke('snippets', text, doc, evalExpr),
  exportPdf: (text) => ipcRenderer.invoke('export-pdf', text),
  print: (text) => ipcRenderer.invoke('print', text),
  fonts: () => ipcRenderer.invoke('fonts'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  importImage: (input) => ipcRenderer.invoke('import-image', input),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fileUrl: (abs) => 'tw://file' + abs.split('/').map(encodeURIComponent).join('/'),
  reveal: () => ipcRenderer.send('reveal'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setInputs: (inputs) => ipcRenderer.invoke('set-inputs', inputs),
  setMainFile: (main) => ipcRenderer.invoke('set-main', main),
  chooseMainFile: () => ipcRenderer.invoke('choose-main'),
  termStart: (opts) => ipcRenderer.invoke('term:start', opts),
  termWrite: (id, data) => ipcRenderer.send('term:write', id, data),
  termResize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
  termKill: (id) => ipcRenderer.send('term:kill', id),
  claudeContext: (text) => ipcRenderer.send('claude:context', text),
  onTermData: (cb) => {
    const handler = (_e: unknown, id: number, data: string) => cb(id, data);
    ipcRenderer.on('term:data', handler);
    return () => {
      ipcRenderer.removeListener('term:data', handler);
    };
  },
  onTermExit: (cb) => {
    const handler = (_e: unknown, id: number, code: number) => cb(id, code);
    ipcRenderer.on('term:exit', handler);
    return () => {
      ipcRenderer.removeListener('term:exit', handler);
    };
  },
  onMenu: (cb) => listen<MenuCommand>('menu', cb),
  onExternalChange: (cb) => listen<string>('file:external', cb),
  onOpened: (cb) => listen<{ path: string; text: string }>('doc:opened', cb),
};

contextBridge.exposeInMainWorld('tw', api);
