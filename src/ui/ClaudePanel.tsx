// KI im Editor: ein echtes Terminal (xterm.js + node-pty), das Claude Code, Codex
// oder einen eigenen Befehl im Projektordner startet. Änderungen der KI an der Datei
// lädt der Editor live nach. Andockbar oben, unten, links oder rechts.

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { PanelBottom, PanelLeft, PanelRight, PanelTop, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { AGENT_NAMES, type AgentDock, type AgentKind } from '../shared/api';
// `t` is the terminal instance below, so the translator is `tr` here
import { t as tr } from '../i18n';

export interface ClaudeHandle {
  /** Text in die Eingabe der KI einfügen (als Einfügen, ohne abzuschicken). */
  paste(text: string): void;
  /** Rohe Eingabe (Tasten), z. B. für Selbsttests. */
  send(data: string): void;
  focus(): void;
  cwd(): string | null;
}

const THEME = {
  background: '#1e1e1e',
  foreground: '#d8d8d8',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#f5f543',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#e5e5e5',
  brightBlack: '#808080',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

const DOCKS: { dock: AgentDock; icon: typeof PanelBottom; label: string }[] = [
  { dock: 'left', icon: PanelLeft, label: 'Dock left' },
  { dock: 'bottom', icon: PanelBottom, label: 'Dock bottom' },
  { dock: 'top', icon: PanelTop, label: 'Dock top' },
  { dock: 'right', icon: PanelRight, label: 'Dock right' },
];

const MIN = 140;

export function ClaudePanel({
  visible,
  dock,
  size,
  agent,
  customCommand,
  onSize,
  onDock,
  onAgent,
  onClose,
  onSendSelection,
  onSubmit,
  onStarted,
  handle,
}: {
  visible: boolean;
  dock: AgentDock;
  /** Höhe (oben/unten) bzw. Breite (links/rechts) in px. */
  size: number;
  agent: AgentKind;
  customCommand: string;
  onSize: (px: number) => void;
  onDock: (d: AgentDock) => void;
  onAgent: (a: AgentKind, command?: string) => void;
  onClose: () => void;
  onSendSelection: () => void;
  /** Enter im Terminal: Nachricht geht an die KI. */
  onSubmit: () => void;
  onStarted: () => void;
  handle: { current: ClaudeHandle | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const cbs = useRef({ onSubmit, onStarted });
  cbs.current = { onSubmit, onStarted };
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const session = useRef<number | null>(null);
  const cwdRef = useRef<string | null>(null);
  const agentRef = useRef({ agent, customCommand });
  agentRef.current = { agent, customCommand };
  const [cwd, setCwd] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [dragSize, setDragSize] = useState<number | null>(null);
  /** Eingabe für den eigenen Befehl (null = nicht offen). */
  const [editingCmd, setEditingCmd] = useState<string | null>(null);
  const vertical = dock === 'left' || dock === 'right';

  const start = async () => {
    const t = term.current;
    if (!t) return;
    if (session.current !== null) window.tw.termKill(session.current);
    session.current = null;
    t.reset();
    setExited(false);
    try {
      fit.current?.fit();
    } catch {
      /* unsichtbar */
    }
    const { agent: a, customCommand: c } = agentRef.current;
    const res = await window.tw.termStart({ cols: t.cols, rows: t.rows, agent: a, command: a === 'custom' ? c : null });
    session.current = res.id;
    setCwd(res.cwd);
    cwdRef.current = res.cwd;
    cbs.current.onStarted();
  };

  useEffect(() => {
    const t = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, monospace',
      fontSize: 12.5,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      theme: THEME,
      allowProposedApi: true,
      // Option bleibt für @, [, ], | usw. auf deutschen Tastaturen nutzbar
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon((_e, uri) => window.tw.openExternal(uri)));
    t.open(host.current!);
    term.current = t;
    fit.current = f;
    // Umschalt+Enter = neue Zeile in der Eingabe (wie Meta+Enter)
    t.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && session.current !== null) {
        window.tw.termWrite(session.current, '\x1b\r');
        return false;
      }
      return true;
    });
    t.onData((d) => {
      if (session.current === null) return;
      // Vor dem Absenden: Stand sichern und Kontext auffrischen, damit die KI das Aktuelle liest
      if (d === '\r') cbs.current.onSubmit();
      window.tw.termWrite(session.current, d);
    });
    t.onResize(({ cols, rows }) => {
      if (session.current !== null) window.tw.termResize(session.current, cols, rows);
    });
    const offData = window.tw.onTermData((id, data) => {
      if (id === session.current) t.write(data);
    });
    const offExit = window.tw.onTermExit((id) => {
      if (id === session.current) {
        session.current = null;
        setExited(true);
        t.write(`\r\n\x1b[2m[${tr('Session ended – “Restart” opens a new one')}]\x1b[0m\r\n`);
      }
    });
    const ro = new ResizeObserver(() => {
      try {
        f.fit();
      } catch {
        /* unsichtbar */
      }
    });
    ro.observe(host.current!);
    void start();
    handle.current = {
      paste: (text) => {
        if (session.current === null) return;
        window.tw.termWrite(session.current, `\x1b[200~${text}\x1b[201~`);
      },
      send: (data) => {
        if (session.current === null) return;
        if (data === '\r') cbs.current.onSubmit();
        window.tw.termWrite(session.current, data);
      },
      focus: () => t.focus(),
      cwd: () => cwdRef.current,
    };
    return () => {
      ro.disconnect();
      offData();
      offExit();
      if (session.current !== null) window.tw.termKill(session.current);
      t.dispose();
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // KI gewechselt: neu starten
  const firstAgent = useRef(true);
  useEffect(() => {
    if (firstAgent.current) {
      firstAgent.current = false;
      return;
    }
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, customCommand]);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      try {
        fit.current?.fit();
      } catch {
        /* egal */
      }
      term.current?.focus();
    });
  }, [visible, size, dock]);

  const clamp = (px: number) => {
    const max = vertical ? window.innerWidth - 420 : window.innerHeight - 260;
    return Math.max(MIN, Math.min(max, px));
  };

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const start0 = vertical ? e.clientX : e.clientY;
    const size0 = size;
    // Ziehen Richtung Arbeitsbereich vergrößert das Panel
    const sign = dock === 'bottom' || dock === 'right' ? -1 : 1;
    const calc = (ev: MouseEvent) => clamp(size0 + sign * ((vertical ? ev.clientX : ev.clientY) - start0));
    const move = (ev: MouseEvent) => setDragSize(calc(ev));
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDragSize(null);
      onSize(calc(ev));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const px = dragSize ?? size;
  const home = (s: string) => s.replace(/^\/Users\/[^/]+/, '~');
  const style: React.CSSProperties = vertical ? { width: px, display: visible ? 'flex' : 'none' } : { height: px, display: visible ? 'flex' : 'none' };
  return (
    <div className={`tw-claude dock-${dock}`} style={style}>
      <div className="tw-claude-resize" onMouseDown={onDragStart} />
      <div className="tw-claude-head">
        <Sparkles size={14} className="tw-claude-logo" />
        <select
          className="tw-agent-select"
          value={agent}
          title={tr('Which AI runs in the terminal')}
          onChange={(e) => {
            const a = e.target.value as AgentKind;
            if (a === 'custom') setEditingCmd(customCommand);
            else {
              setEditingCmd(null);
              onAgent(a);
            }
          }}
        >
          {(Object.keys(AGENT_NAMES) as AgentKind[]).map((k) => (
            <option key={k} value={k}>
              {k === 'custom' ? tr('Custom command …') : AGENT_NAMES[k]}
            </option>
          ))}
        </select>
        {editingCmd !== null && (
          <form
            className="tw-agent-cmd"
            onSubmit={(e) => {
              e.preventDefault();
              onAgent('custom', editingCmd.trim());
              setEditingCmd(null);
            }}
          >
            <input
              autoFocus
              value={editingCmd}
              placeholder={tr('e.g. gemini, opencode, aider (empty = shell)')}
              onChange={(e) => setEditingCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditingCmd(null)}
            />
            <button type="submit">{tr('Start')}</button>
          </form>
        )}
        {agent === 'custom' && editingCmd === null && (
          <button className="tw-agent-cmd-label" onClick={() => setEditingCmd(customCommand)} title={tr('Change command: {cmd}', { cmd: customCommand || 'shell' })}>
            {customCommand || 'shell'}
          </button>
        )}
        {!vertical && cwd && <span className="tw-claude-cwd">{home(cwd)}</span>}
        {exited && <span className="tw-claude-exited">{tr('ended')}</span>}
        <div className="tw-pane-spacer" />
        <button onClick={onSendSelection} title={tr('Send selection to the AI (⌘L)')}>
          <Send size={13} /> {vertical ? '' : tr('Send selection')}
        </button>
        <button onClick={() => void start()} title={tr('Restart')}>
          <RotateCcw size={13} /> {vertical ? '' : tr('Restart')}
        </button>
        <span className="tw-claude-docks">
          {DOCKS.map(({ dock: d, icon: Icon, label }) => (
            <button key={d} className={d === dock ? 'on' : ''} onClick={() => onDock(d)} title={tr(label)}>
              <Icon size={14} />
            </button>
          ))}
        </span>
        <button onClick={onClose} title={tr('Hide (⌘J)')}>
          <X size={14} />
        </button>
      </div>
      <div className="tw-claude-term" ref={host} />
    </div>
  );
}
