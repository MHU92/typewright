// Dialogs: Typst code, link, table, inputs (sys.inputs) and the File view ("backstage").

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FilePlus2, FolderOpen, FileDown, Printer, Info, X, FileText, Save, FolderSearch, Settings as SettingsIcon, Heart } from 'lucide-react';
import type { CodeEditRequest } from '../editor/context';
import { CodeEditor } from './CodeEditor';
import { AGENT_NAMES, type AgentKind, type MenuCommand, type ProjectInfo, type Settings } from '../shared/api';
import { getTemplates } from './templates';
import { getLang, t } from '../i18n';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="tw-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`tw-modal ${wide ? 'wide' : ''}`}>
        <div className="tw-modal-head">
          <span>{title}</span>
          <button onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CodeDialog({ request, onClose }: { request: CodeEditRequest; onClose: () => void }) {
  const [code, setCode] = useState(request.code);
  const save = () => {
    request.onSave(code);
    onClose();
  };
  const lines = request.code.split('\n').length;
  return (
    <Modal title={request.title} onClose={onClose} wide={lines > 6}>
      {request.hint && <div className="tw-modal-hint">{request.hint}</div>}
      <div className={`tw-modal-code ${lines > 6 ? 'tall' : ''}`}>
        <CodeEditor value={request.code} onChange={setCode} onSubmit={save} autoFocus lineNumbers={lines > 3} />
      </div>
      <div className="tw-modal-foot">
        {request.onDelete && (
          <button
            className="tw-button danger"
            onClick={() => {
              request.onDelete!();
              onClose();
            }}
          >
            {t('Remove')}
          </button>
        )}
        <div className="tw-pane-spacer" />
        <span className="tw-modal-kbd">{t('⌘↩ to apply')}</span>
        <button className="tw-button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="tw-button primary" onClick={save}>
          {t('Apply')}
        </button>
      </div>
    </Modal>
  );
}

export function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = editor.getAttributes('link').href as string | undefined;
  const { from, to, empty } = editor.state.selection;
  const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
  const [href, setHref] = useState(current ?? (/^https?:\/\//.test(selected) ? selected : 'https://'));
  const [text, setText] = useState(selected);
  const apply = () => {
    const url = href.trim();
    if (!url || url === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else if (empty && !current) {
      const label = text || url;
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: url, form: 'call' } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    onClose();
  };
  return (
    <Modal title={t('Link')} onClose={onClose}>
      <div className="tw-form">
        {empty && !current && (
          <label>
            {t('Text to display')}
            <input className="tw-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('(otherwise the address)')} />
          </label>
        )}
        <label>
          {t('Address')}
          <input className="tw-input" autoFocus value={href} onChange={(e) => setHref(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </label>
      </div>
      <div className="tw-modal-foot">
        {current && (
          <button
            className="tw-button danger"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              onClose();
            }}
          >
            {t('Remove link')}
          </button>
        )}
        <div className="tw-pane-spacer" />
        <button className="tw-button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="tw-button primary" onClick={apply}>
          OK
        </button>
      </div>
    </Modal>
  );
}

export function TableDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  const apply = () => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: header }).run();
    onClose();
  };
  return (
    <Modal title={t('Insert table')} onClose={onClose}>
      <div className="tw-form tw-form-grid">
        <label>
          {t('Columns')}
          <input className="tw-input" type="number" min={1} max={30} value={cols} onChange={(e) => setCols(Number(e.target.value))} />
        </label>
        <label>
          {t('Rows')}
          <input className="tw-input" type="number" min={1} max={200} value={rows} onChange={(e) => setRows(Number(e.target.value))} />
        </label>
        <label className="tw-check">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('First row as header row')}
        </label>
      </div>
      <div className="tw-modal-foot">
        <div className="tw-pane-spacer" />
        <button className="tw-button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="tw-button primary" onClick={apply}>
          {t('Insert')}
        </button>
      </div>
    </Modal>
  );
}

/** `sys.inputs` for preview and export, with suggestions taken from the source. */
export function InputsDialog({ inputs, source, onSave, onClose }: { inputs: Record<string, string>; source: string; onSave: (i: Record<string, string>) => void; onClose: () => void }) {
  const found = useMemo(() => {
    const out = new Map<string, string>();
    const re = /sys\.inputs\.at\(\s*"([^"]+)"\s*(?:,\s*default:\s*"([^"]*)")?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) if (!out.has(m[1])) out.set(m[1], m[2] ?? '');
    return out;
  }, [source]);
  const [rows, setRows] = useState<[string, string][]>(() => {
    const keys = new Set([...found.keys(), ...Object.keys(inputs)]);
    return [...keys].map((k) => [k, inputs[k] ?? '']);
  });
  const first = useRef<HTMLInputElement>(null);
  return (
    <Modal title={t('Typst inputs (sys.inputs)')} onClose={onClose}>
      <div className="tw-modal-hint">
        {t('Same as')} <code>typst compile --input name=value</code>. {t('Used for preview, export and printing of this file. Empty values are not passed, so the document default applies.')}
      </div>
      <div className="tw-inputs">
        {rows.map(([k, v], i) => (
          <div key={i} className="tw-inputs-row">
            <input
              ref={i === 0 ? first : undefined}
              className="tw-input"
              value={k}
              placeholder={t('Name')}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            />
            <span>=</span>
            <input
              className="tw-input"
              value={v}
              placeholder={found.get(k) ? t('Default: {v}', { v: found.get(k) ?? '' }) : t('Value')}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            />
            <button onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="tw-text-btn" onClick={() => setRows([...rows, ['', '']])}>
          {t('+ Add input')}
        </button>
      </div>
      <div className="tw-modal-foot">
        <div className="tw-pane-spacer" />
        <button className="tw-button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button
          className="tw-button primary"
          onClick={() => onSave(Object.fromEntries(rows.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()])))}
        >
          {t('Apply')}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ File view ("backstage")

type BackstageView = 'info' | 'new' | 'open' | 'options' | 'about';

export function Backstage(p: {
  path: string | null;
  project: ProjectInfo | null;
  settings: Settings;
  stats: { words: number; chars: number };
  pages: number;
  typstVersion: string | null;
  initialView?: BackstageView;
  onClose: () => void;
  onCommand: (c: MenuCommand) => void;
  onTemplate: (text: string) => void;
  onChooseMain: () => void;
  onResetMain: () => void;
  onSettings: (patch: Partial<Settings>) => void;
}) {
  const [view, setView] = useState<BackstageView>(p.initialView ?? (p.path ? 'info' : 'new'));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);
  const home = (s: string) => s.replace(/^\/Users\/[^/]+/, '~');
  const locale = getLang() === 'de' ? 'de-DE' : 'en-US';
  const link = (url: string, label: string) => (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        window.tw.openExternal(url);
      }}
    >
      {label}
    </a>
  );
  return (
    <div className="tw-backstage">
      <div className="tw-backstage-nav">
        <button className="tw-backstage-back" onClick={p.onClose}>
          ← {t('Back')}
        </button>
        <button className={view === 'info' ? 'on' : ''} onClick={() => setView('info')}>
          <Info size={16} /> {t('Info')}
        </button>
        <button className={view === 'new' ? 'on' : ''} onClick={() => setView('new')}>
          <FilePlus2 size={16} /> {t('New')}
        </button>
        <button className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>
          <FolderOpen size={16} /> {t('Open')}
        </button>
        <div className="tw-backstage-sep" />
        <button onClick={() => p.onCommand('save')}>
          <Save size={16} /> {t('Save')}
        </button>
        <button onClick={() => p.onCommand('save-as')}>
          <Save size={16} /> {t('Save As')}
        </button>
        <button onClick={() => p.onCommand('export-pdf')}>
          <FileDown size={16} /> {t('Export as PDF')}
        </button>
        <button onClick={() => p.onCommand('print')}>
          <Printer size={16} /> {t('Print')}
        </button>
        <div className="tw-backstage-sep" />
        <button className={view === 'options' ? 'on' : ''} onClick={() => setView('options')}>
          <SettingsIcon size={16} /> {t('Options')}
        </button>
        <button className={view === 'about' ? 'on' : ''} onClick={() => setView('about')}>
          <Heart size={16} /> {t('About')}
        </button>
      </div>
      <div className="tw-backstage-body">
        {view === 'info' && (
          <>
            <h1>{t('Info')}</h1>
            <div className="tw-info-grid">
              <div>{t('File')}</div>
              <div>{p.path ? home(p.path) : t('Not saved yet')}</div>
              <div>{t('Pages')}</div>
              <div>{p.pages}</div>
              <div>{t('Words')}</div>
              <div>{p.stats.words.toLocaleString(locale)}</div>
              <div>{t('Characters')}</div>
              <div>{t('{n} (without spaces)', { n: p.stats.chars.toLocaleString(locale) })}</div>
              <div>{t('Project root')}</div>
              <div>{p.project?.root ? home(p.project.root) : '–'}</div>
              <div>{t('Preview compiles')}</div>
              <div>
                {p.project?.main ? home(p.project.main) : t('this file')}
                {p.path && (
                  <span className="tw-info-actions">
                    <button className="tw-text-btn" onClick={p.onChooseMain}>
                      {t('Other main file …')}
                    </button>
                    {p.path && p.settings.mainByFile[p.path] && (
                      <button className="tw-text-btn" onClick={p.onResetMain}>
                        {t('Automatic')}
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div>Typst</div>
              <div>{p.typstVersion ?? t('not found (brew install typst)')}</div>
            </div>
            {p.path && (
              <button className="tw-button" onClick={() => p.onCommand('reveal')}>
                <FolderSearch size={14} /> {t('Show in Finder')}
              </button>
            )}
          </>
        )}
        {view === 'new' && (
          <>
            <h1>{t('New')}</h1>
            <div className="tw-templates">
              {getTemplates().map((tpl) => (
                <button key={tpl.id} className="tw-template" onClick={() => p.onTemplate(tpl.text)}>
                  <div className={`tw-template-thumb t-${tpl.id}`}>
                    <FileText size={30} />
                  </div>
                  <b>{tpl.name}</b>
                  <span>{tpl.description}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {view === 'open' && (
          <>
            <h1>{t('Open')}</h1>
            <button className="tw-button primary" onClick={() => p.onCommand('open')}>
              <FolderOpen size={14} /> {t('Browse …')}
            </button>
            <h2>{t('Recent')}</h2>
            <div className="tw-recent">
              {p.settings.recent.length === 0 && <div className="tw-menu-empty">{t('Nothing opened yet.')}</div>}
              {p.settings.recent.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    void window.tw.openPath(f);
                    p.onClose();
                  }}
                >
                  <FileText size={18} />
                  <div>
                    <b>{f.split('/').pop()}</b>
                    <span>{home(f.slice(0, f.lastIndexOf('/')))}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {view === 'options' && (
          <>
            <h1>{t('Options')}</h1>
            <div className="tw-options">
              <label>
                <span>{t('Language')}</span>
                <select className="tw-select" value={p.settings.language} onChange={(e) => p.onSettings({ language: e.target.value as Settings['language'] })}>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </select>
              </label>
              <label>
                <span>{t('AI in the terminal')}</span>
                <select className="tw-select" value={p.settings.agent} onChange={(e) => p.onSettings({ agent: e.target.value as AgentKind })}>
                  {(Object.keys(AGENT_NAMES) as AgentKind[]).map((k) => (
                    <option key={k} value={k}>
                      {k === 'custom' ? t('Custom command') : AGENT_NAMES[k]}
                    </option>
                  ))}
                </select>
              </label>
              {p.settings.agent === 'custom' && (
                <label>
                  <span>{t('Command')}</span>
                  <input
                    className="tw-input"
                    defaultValue={p.settings.customCommand}
                    placeholder={t('e.g. gemini, opencode, aider (empty = shell)')}
                    onBlur={(e) => p.onSettings({ customCommand: e.target.value.trim() })}
                  />
                </label>
              )}
              <label className="tw-check">
                <input type="checkbox" checked={p.settings.autoSave} onChange={(e) => p.onSettings({ autoSave: e.target.checked })} />
                <span>{t('AutoSave (always on while the AI terminal is open)')}</span>
              </label>
            </div>
          </>
        )}
        {view === 'about' && (
          <div className="tw-about">
            <h1>Typewright</h1>
            <p className="tw-about-sub">{t('A word processor for Typst.')}</p>
            <h2>{t('Built on Typst')}</h2>
            <p>
              {t(
                'Typewright exists because Typst is wonderful. Parsing uses the official typst-syntax crate, and every page you see in the preview is rendered by the Typst compiler itself. All the hard typesetting work is theirs.',
              )}
            </p>
            <p>
              {t('Huge thanks to Laurenz Mädje, Martin Haug and all Typst contributors.')} {link('https://typst.app', 'typst.app')} ·{' '}
              {link('https://github.com/typst/typst', 'github.com/typst/typst')}
            </p>
            <p className="tw-about-note">
              {t('Typst is a trademark of Typst GmbH. Typewright is an independent, non-commercial open-source project and is not affiliated with or endorsed by Typst GmbH.')}
            </p>
            <h2>{t('Open source')}</h2>
            <p>
              {t('Typewright is free software under the Apache License 2.0.')} {link('https://github.com/MHU92/typewright', 'github.com/MHU92/typewright')}
            </p>
            <p className="tw-about-note">
              {t('It also builds on Electron, React, TipTap/ProseMirror, CodeMirror, xterm.js and node-pty. Claude Code and Codex are products of Anthropic and OpenAI; Typewright only starts the command-line tools you have installed.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
