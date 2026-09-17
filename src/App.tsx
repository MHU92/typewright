import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Placeholder } from '@tiptap/extensions';
import type { AnyExtension } from '@tiptap/core';
import { editorExtensions } from './editor/schema';
import { CallBlockView, ImageView, MathBlockView, MathInlineView, PageBreakView, TocView, TypstBlockView, TypstInlineView } from './editor/nodeviews';
import { FindExtension } from './editor/find';
import {
  applyFormatPainter,
  clearFormatting,
  insertFootnote,
  insertImage,
  insertMath,
  insertTypst,
  setAlignWithDefault,
  shortcutsExtension,
  ui,
} from './editor/commands';
import { registerCodeDialog, setDocContext, type CodeEditRequest } from './editor/context';
import { loadDocument, saveDocument } from './typst/document';
import type { PreserveMap } from './typst/serialize';
import { planSnippets, renderSnippets, renders, rewritePaths, useGeometry } from './render/snippets';
import type { InitInfo, MenuCommand, PreviewResult, ProjectInfo, Settings } from './shared/api';
import { Ribbon } from './ui/Ribbon';
import { FindBar, NavPane, PreviewPane, Problems, SourcePane, StatusBar, TitleBar, type ScrollAnchor } from './ui/Panes';
import { Backstage, CodeDialog, InputsDialog, LinkDialog, TableDialog } from './ui/Dialogs';
import { getTemplates } from './ui/templates';
import { setLang, t } from './i18n';
import { useLang } from './ui/useLang';
import { numberingCss } from './ui/numbering';
import { flashBlocks, replaceChangedBlocks, revealRange } from './editor/reload';
import { ClaudePanel, type ClaudeHandle } from './ui/ClaudePanel';
import { buildClaudeContext } from './editor/claudeContext';

interface DocRef {
  lead: string;
  trail: string;
  preserve: PreserveMap;
  savedText: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NODE_VIEWS: Record<string, React.ComponentType<any>> = {
  typstBlock: TypstBlockView,
  typstInline: TypstInlineView,
  mathBlock: MathBlockView,
  mathInline: MathInlineView,
  callBlock: CallBlockView,
  image: ImageView,
  toc: TocView,
  pageBreak: PageBreakView,
};

function withNodeViews(exts: AnyExtension[]): AnyExtension[] {
  return exts.map((ext) => {
    const view = NODE_VIEWS[ext.name];
    if (!view) return ext;
    const inline = ext.name === 'typstInline' || ext.name === 'mathInline';
    return (ext as ReturnType<typeof import('@tiptap/core').Node.create>).extend({
      addNodeView() {
        return ReactNodeViewRenderer(view, { as: inline ? 'span' : 'div', className: inline ? 'tw-nv-inline' : 'tw-nv-block' });
      },
    });
  });
}

/** Wo steht der Leser im Editor, gemessen an den Überschriften? (für die mitlaufende Vorschau) */
function computeAnchor(el: HTMLElement): ScrollAnchor {
  const heads = [...el.querySelectorAll<HTMLElement>('.tw-prose h1, .tw-prose h2, .tw-prose h3, .tw-prose h4, .tw-prose h5, .tw-prose h6')];
  const base = el.getBoundingClientRect().top;
  const line = el.scrollTop + 60;
  const tops = heads.map((h) => h.getBoundingClientRect().top - base + el.scrollTop);
  let index = -1;
  while (index + 1 < tops.length && tops[index + 1] <= line) index++;
  const a = index < 0 ? 0 : tops[index];
  const b = index + 1 < tops.length ? tops[index + 1] : el.scrollHeight;
  return {
    index,
    frac: Math.min(1, Math.max(0, (line - a) / Math.max(1, b - a))),
    texts: heads.map((h) => h.textContent ?? ''),
    docFrac: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
  };
}

function countWords(text: string) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

export default function App() {
  const [init, setInit] = useState<InitInfo | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [mainPreamble, setMainPreamble] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [external, setExternal] = useState<string | null>(null);
  const [toast, setToastState] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const setToast = useCallback((text: string | null, action?: { label: string; run: () => void }) => setToastState(text ? { text, action } : null), []);
  const [find, setFind] = useState<false | 'find' | 'replace'>(false);
  const [codeDialog, setCodeDialog] = useState<CodeEditRequest | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [backstage, setBackstage] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [scrollFrac, setScrollFrac] = useState(0);
  const [anchor, setAnchor] = useState<ScrollAnchor>({ index: -1, frac: 0, texts: [], docFrac: 0 });
  const anchorFrame = useRef<number | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [editorWidth, setEditorWidth] = useState(0);
  /** Das Claude-Terminal wird erst beim ersten Öffnen gestartet und läuft dann weiter. */
  const [claudeStarted, setClaudeStarted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [snippetMs, setSnippetMs] = useState<number | null>(null);
  const geometry = useGeometry();

  const docRef = useRef<DocRef>({ lead: '', trail: '\n', preserve: new Map(), savedText: '' });
  const dirtyRef = useRef(false);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const editorScroll = useRef<HTMLDivElement>(null);
  const sourceFocused = useRef(false);

  const extensions = useMemo(
    () => [
      ...withNodeViews(editorExtensions()),
      FindExtension,
      shortcutsExtension({ justifyDefault: () => !!geometryRef.current?.justify }),
      Placeholder.configure({ placeholder: () => t('Start writing …'), showOnlyWhenEditable: true, showOnlyCurrent: true }),
    ],
    [],
  );

  const setDirty = useCallback((v: boolean) => {
    if (dirtyRef.current === v) return;
    dirtyRef.current = v;
    setDirtyState(v);
    window.tw.setDirty(v);
  }, []);

  const editor = useEditor({
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'tw-prose', spellcheck: 'true' },
      // Bilder aus der Zwischenablage (z. B. Screenshots) neben dem Dokument ablegen
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void (async () => {
          for (const f of files) {
            const src = await window.tw.importImage({ data: await f.arrayBuffer(), ext: f.type.split('/')[1] });
            if (src) view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image.create({ src, width: '80%' })));
          }
        })();
        return true;
      },
      // Bilddateien hineinziehen; .typ-Dateien öffnen
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        const images = files.filter((f) => f.type.startsWith('image/'));
        const typ = files.filter((f) => f.name.endsWith('.typ'));
        if (!images.length && !typ.length) return false;
        event.preventDefault();
        for (const f of typ) void window.tw.openPath(window.tw.pathForFile(f));
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        void (async () => {
          for (const f of images) {
            const src = await window.tw.importImage({ path: window.tw.pathForFile(f) });
            if (src) view.dispatch(view.state.tr.insert(Math.min(pos, view.state.doc.content.size), view.state.schema.nodes.image.create({ src, width: '80%' })));
          }
        })();
        return true;
      },
      handleDOMEvents: {
        mouseup: () => {
          setTimeout(() => editorRef.current && applyFormatPainter(editorRef.current), 0);
          return false;
        },
      },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged && !transaction.getMeta('twLoad')) setDirty(true);
      scheduleWork();
    },
  });
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  // ---------------------------------------------------------------- Serialisieren

  const serialize = useCallback((): string => {
    const ed = editorRef.current;
    if (!ed) return '';
    return saveDocument(ed.getJSON() as never, docRef.current, { justifyDefault: !!geometryRef.current?.justify });
  }, []);

  // ---------------------------------------------------------------- Vorschau & Schnipsel

  const previewState = useRef({ running: false, pending: false, lastText: '' });
  const snippetState = useRef({ running: false, pending: false, signature: '', lastMargins: '' });
  const workTimer = useRef<number | null>(null);
  const snippetTimer = useRef<number | null>(null);
  const mainPreambleRef = useRef(mainPreamble);
  mainPreambleRef.current = mainPreamble;

  const runPreview = useCallback(async (force = false) => {
    const st = previewState.current;
    if (st.running) {
      st.pending = true;
      return;
    }
    const text = serialize();
    if (!force && text === st.lastText) return;
    st.running = true;
    setCompiling(true);
    try {
      const res = await window.tw.preview(text);
      st.lastText = text;
      setPreview(res);
      if (editorScroll.current) setAnchor(computeAnchor(editorScroll.current));
    } finally {
      st.running = false;
      setCompiling(false);
    }
    if (st.pending) {
      st.pending = false;
      void runPreview();
    }
  }, [serialize]);

  const runSnippets = useCallback(async (force = false) => {
    const ed = editorRef.current;
    if (!ed) return;
    const st = snippetState.current;
    if (st.running) {
      st.pending = true;
      return;
    }
    const g = geometryRef.current;
    const margins: [number, number] | null = g ? [g.marginLeft, g.marginRight] : null;
    const plan = planSnippets(ed.state.doc, mainPreambleRef.current, new Set(), false, margins);
    if (!force && plan.signature === st.signature) return;
    st.running = true;
    let marginsChanged = false;
    try {
      const outcome = await renderSnippets(
        ed.state.doc,
        serialize(),
        mainPreambleRef.current,
        (text, doc, evalExpr) => window.tw.snippets(text, doc, evalExpr),
        margins,
      );
      st.signature = plan.signature;
      setSnippetMs(Math.round(outcome.ms));
      const ng = outcome.geometry;
      // Erst jetzt bekannte (oder geänderte) Ränder: einmal mit festen Rändern nachrendern
      marginsChanged = !!ng && (!margins || Math.abs(ng.marginLeft - margins[0]) > 0.1 || Math.abs(ng.marginRight - margins[1]) > 0.1);
    } finally {
      st.running = false;
    }
    if (marginsChanged) st.pending = true;
    if (st.pending) {
      st.pending = false;
      void runSnippets();
    }
  }, [serialize]);

  const scheduleWork = useCallback(() => {
    if (workTimer.current) window.clearTimeout(workTimer.current);
    workTimer.current = window.setTimeout(() => {
      // Wieder auf dem gesicherten Stand (z. B. nach Widerrufen)? Dann nicht mehr „bearbeitet“
      if (dirtyRef.current && docRef.current.savedText && serialize() === docRef.current.savedText) setDirty(false);
      void runPreview();
      const ed = editorRef.current;
      if (ed) {
        const text = ed.state.doc.textBetween(0, ed.state.doc.content.size, ' ', ' ');
        setStats({ words: countWords(text), chars: text.replace(/\s/g, '').length });
      }
      if (settingsRef.current?.showSource && !sourceFocused.current) setSourceText(serialize());
    }, 280);
    if (snippetTimer.current) window.clearTimeout(snippetTimer.current);
    snippetTimer.current = window.setTimeout(() => void runSnippets(), 450);
  }, [runPreview, runSnippets, serialize]);

  // ---------------------------------------------------------------- Laden

  const refreshProject = useCallback(async (text: string) => {
    const info = await window.tw.project(text);
    setProject(info);
    setDocContext({ root: info.root });
    if (info.main && info.mainText && info.file && info.main !== info.file && info.root) {
      try {
        const tree = await window.tw.parse(info.mainText);
        const ed = editorRef.current!;
        const loadedMain = loadDocument(ed.schema, info.mainText, tree);
        const code = (loadedMain.doc.content ?? [])
          .filter((b) => b.type === 'typstBlock' && b.attrs?.kind === 'code')
          .map((b) => String(b.attrs!.src));
        const mainDir = info.main.slice(0, info.main.lastIndexOf('/'));
        setMainPreamble(code.length ? rewritePaths(code.join('\n'), mainDir, info.root) : null);
      } catch {
        setMainPreamble(null);
      }
    } else setMainPreamble(null);
  }, []);

  const loadText = useCallback(
    async (text: string, opts: { keepScroll?: boolean; markDirty?: boolean; smooth?: boolean } = {}) => {
      const ed = editorRef.current;
      if (!ed) return;
      const tree = await window.tw.parse(text);
      const result = loadDocument(ed.schema, text, tree);
      // Beim Nachladen derselben Datei die alten Original-Ausschnitte behalten: nimmt ⌘Z eine
      // Änderung von außen zurück, kommt der alte Wortlaut so wieder Zeichen für Zeichen zurück
      const preserve = opts.smooth || opts.markDirty ? new Map([...docRef.current.preserve, ...result.preserve]) : result.preserve;
      docRef.current = { lead: result.lead, trail: result.trail, preserve, savedText: opts.markDirty ? docRef.current.savedText : text };
      const doc = ed.schema.nodeFromJSON(result.doc);
      const scroll = editorScroll.current?.scrollTop ?? 0;
      if (opts.smooth) {
        // Nur den geänderten Bereich ersetzen: Cursor bleibt, ⌘Z nimmt die Änderung zurück
        const changed = replaceChangedBlocks(ed, doc);
        setDirty(false);
        if (changed) {
          flashBlocks(ed, changed.from, changed.to);
          // Arbeitet Claude gerade, zur geänderten Stelle scrollen, falls sie nicht im Bild ist
          if (settingsRef.current?.showClaude) revealRange(ed, changed.from, editorScroll.current);
        }
      } else if (opts.markDirty) {
        const tr = ed.state.tr.replaceWith(0, ed.state.doc.content.size, doc.content);
        ed.view.dispatch(tr);
      } else {
        // Cursor in den ersten Text statt auf einen Code-Block am Anfang
        const selection = TextSelection.findFrom(doc.resolve(0), 1, true) ?? undefined;
        ed.view.updateState(EditorState.create({ doc, plugins: ed.state.plugins, selection }));
        setDirty(false);
      }
      if (opts.keepScroll && editorScroll.current) editorScroll.current.scrollTop = scroll;
      setSourceText(text);
      setLoaded(true);
      scheduleWork();
    },
    [scheduleWork, setDirty],
  );

  useEffect(() => {
    if (!editor) return;
    let alive = true;
    void (async () => {
      const info = await window.tw.init();
      if (!alive) return;
      setInit(info);
      setSettings(info.settings);
      setLang(info.settings.language);
      if (info.settings.showClaude) setClaudeStarted(true);
      setPath(info.path);
      setDocContext({ path: info.path, dir: info.path ? info.path.slice(0, info.path.lastIndexOf('/')) : null, showMarks: info.settings.showMarks });
      if (info.text !== null) {
        await refreshProject(info.text);
        await loadText(info.text);
      } else {
        await loadText(getTemplates()[0].text);
        docRef.current.savedText = '';
        setBackstage(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editor, loadText, refreshProject]);

  // Hauptdatei geändert → Schnipsel neu
  useEffect(() => {
    if (loaded) void runSnippets(true);
  }, [mainPreamble, loaded, runSnippets]);

  // ---------------------------------------------------------------- Speichern

  const save = useCallback(
    async (saveAs = false, force = false): Promise<boolean> => {
      const text = serialize();
      const res = await window.tw.save(text, saveAs, force, docRef.current.savedText || null);
      if (res.status === 'cancelled') return false;
      if (res.status === 'conflict') {
        // Inzwischen von außen geändert (z. B. Claude Code): nichts überschreiben, nachfragen
        setExternal(res.diskText);
        return false;
      }
      const target = res.path;
      const isNewPath = target !== pathRef.current;
      docRef.current.savedText = text;
      setPath(target);
      setDocContext({ path: target, dir: target.slice(0, target.lastIndexOf('/')) });
      setDirty(false);
      if (isNewPath) void refreshProject(text);
      return true;
    },
    [serialize, setDirty, refreshProject],
  );
  const pathRef = useRef(path);
  pathRef.current = path;

  // ---------------------------------------------------------------- Befehle

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    const next = await window.tw.setSettings(patch);
    setSettings(next);
    if (patch.showMarks !== undefined) setDocContext({ showMarks: patch.showMarks });
    if (patch.language) setLang(patch.language);
  }, []);

  const pickImage = useCallback(async () => {
    const src = await window.tw.pickImage();
    if (src && editorRef.current) insertImage(editorRef.current, src);
  }, []);

  // ---------------------------------------------------------------- Claude Code

  const claudeRef = useRef<ClaudeHandle | null>(null);

  /** Markierung (oder nur die Datei) in Claudes Eingabe legen, wie ⌘L in Cursor. */
  const sendToClaude = useCallback(async () => {
    const ed = editorRef.current;
    const s = settingsRef.current;
    if (!ed || !s) return;
    if (!s.showClaude) {
      setClaudeStarted(true);
      await updateSettings({ showClaude: true });
    }
    // Claude liest die Datei von der Platte: vorher den aktuellen Stand sichern
    if (dirtyRef.current && pathRef.current) await save(false);
    const { from, to, empty } = ed.state.selection;
    const selected = empty ? '' : ed.state.doc.textBetween(from, to, '\n', ' ').trim();
    let heading = '';
    ed.state.doc.descendants((n, pos) => {
      if (pos >= from) return false;
      if (n.type.name === 'heading') heading = n.textContent;
      return n.type.name !== 'heading';
    });
    for (let i = 0; i < 40 && !claudeRef.current?.cwd(); i++) await new Promise((r) => setTimeout(r, 100));
    const handle = claudeRef.current;
    if (!handle) return;
    const cwd = handle.cwd() ?? '';
    const file = pathRef.current;
    const rel = file ? (cwd && file.startsWith(cwd + '/') ? file.slice(cwd.length + 1) : file) : '';
    const ref = rel ? `@${rel} ` : '';
    const where = heading ? t('(section “{heading}”) ', { heading }) : '';
    handle.paste(selected ? `${ref}${where}${t('passage: “{text}”', { text: selected })} ` : ref);
    handle.focus();
  }, [save, updateSettings]);

  const runCommand = useCallback(
    async (cmd: MenuCommand) => {
      const ed = editorRef.current;
      if (!ed) return;
      const s = settingsRef.current;
      const justify = !!geometryRef.current?.justify;
      const c = () => ed.chain().focus();
      switch (cmd) {
        case 'new':
          return window.tw.newWindow();
        case 'open':
          return window.tw.open();
        case 'save':
          return void save(false);
        case 'save-as':
          return void save(true);
        case 'save-and-close':
          if (await save(false)) window.tw.closeNow();
          return;
        case 'export-pdf': {
          const out = await window.tw.exportPdf(serialize());
          if (out) setToast(t('PDF saved: {file}', { file: out.split('/').pop() ?? '' }));
          return;
        }
        case 'print':
          return window.tw.print(serialize());
        case 'undo':
          return void c().undo().run();
        case 'redo':
          return void c().redo().run();
        case 'find':
          return setFind('find');
        case 'replace':
          return setFind('replace');
        case 'paste-typst': {
          const text = await navigator.clipboard.readText();
          if (!text) return;
          const tree = await window.tw.parse(text);
          const part = loadDocument(ed.schema, text, tree);
          c().insertContent(part.doc.content ?? []).run();
          return;
        }
        case 'bold':
          return void c().toggleBold().run();
        case 'italic':
          return void c().toggleItalic().run();
        case 'underline':
          return void c().toggleUnderline().run();
        case 'strike':
          return void c().toggleStrike().run();
        case 'superscript':
          return void c().toggleSuperscript().run();
        case 'subscript':
          return void c().toggleSubscript().run();
        case 'clear-format':
          return clearFormatting(ed);
        case 'heading-0':
          return void c().setParagraph().run();
        case 'heading-1':
        case 'heading-2':
        case 'heading-3':
        case 'heading-4':
          return void c()
            .setHeading({ level: Number(cmd.slice(-1)) as 1 | 2 | 3 | 4 })
            .run();
        case 'bullet-list':
          return void c().toggleBulletList().run();
        case 'ordered-list':
          return void c().toggleOrderedList().run();
        case 'align-left':
          return setAlignWithDefault(ed, 'left', justify);
        case 'align-center':
          return setAlignWithDefault(ed, 'center', justify);
        case 'align-right':
          return setAlignWithDefault(ed, 'right', justify);
        case 'align-justify':
          return setAlignWithDefault(ed, 'justify', justify);
        case 'insert-image':
          return pickImage();
        case 'insert-table':
          return setTableOpen(true);
        case 'insert-link':
          return setLinkOpen(true);
        case 'insert-footnote':
          return insertFootnote(ed);
        case 'insert-math':
          return insertMath(ed, false);
        case 'insert-pagebreak':
          return void c().insertContent({ type: 'pageBreak' }).run();
        case 'insert-toc':
          return void c().insertContent({ type: 'toc' }).run();
        case 'insert-code':
          return void c().toggleCodeBlock().run();
        case 'insert-typst':
          return insertTypst(ed);
        case 'toggle-preview':
          return s && updateSettings({ showPreview: !s.showPreview });
        case 'toggle-source':
          if (s && !s.showSource) setSourceText(serialize());
          return s && updateSettings({ showSource: !s.showSource });
        case 'toggle-nav':
          return s && updateSettings({ showNav: !s.showNav });
        case 'toggle-marks':
          return s && updateSettings({ showMarks: !s.showMarks });
        case 'zoom-in':
          return s && updateSettings({ zoom: Math.min(3, Math.round((s.zoom + 0.1) * 10) / 10) });
        case 'zoom-out':
          return s && updateSettings({ zoom: Math.max(0.4, Math.round((s.zoom - 0.1) * 10) / 10) });
        case 'zoom-reset':
          return s && updateSettings({ zoom: 1 });
        case 'reveal':
          return window.tw.reveal();
        case 'document-info':
          return setBackstage(true);
        case 'inputs':
          return setInputsOpen(true);
        case 'toggle-claude':
          if (s && !s.showClaude) setClaudeStarted(true);
          return s && updateSettings({ showClaude: !s.showClaude });
        case 'send-to-claude':
          return sendToClaude();
      }
    },
    [save, serialize, pickImage, updateSettings, sendToClaude],
  );

  useEffect(() => window.tw.onMenu((cmd) => void runCommand(cmd)), [runCommand]);

  useEffect(
    () =>
      window.tw.onExternalChange((text) => {
        if (text === serialize()) return;
        if (!dirtyRef.current) {
          void loadText(text, { keepScroll: true, smooth: true });
          const s = settingsRef.current;
          const who = s?.showClaude ? (s.agent === 'codex' ? 'Codex' : s.agent === 'claude' ? 'Claude' : t('The AI')) : null;
          setToast(who ? t('{who} changed the document', { who }) : t('Change from outside applied'), {
            label: t('Undo'),
            run: () => editorRef.current?.chain().focus().undo().run(),
          });
        } else setExternal(text);
      }),
    [loadText, serialize, refreshProject],
  );

  useEffect(
    () =>
      window.tw.onOpened(({ path: p, text }) => {
        setPath(p);
        setDocContext({ path: p, dir: p.slice(0, p.lastIndexOf('/')) });
        renders.clear();
        snippetState.current.signature = '';
        void refreshProject(text).then(() => loadText(text));
      }),
    [loadText, refreshProject],
  );

  // Claude den aktuellen Kontext (Datei, Gliederung, Cursor, Markierung) bereitstellen
  const projectRef = useRef(project);
  projectRef.current = project;
  const pushClaudeContext = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    window.tw.claudeContext(
      buildClaudeContext(ed, {
        path: pathRef.current,
        cwd: claudeRef.current?.cwd() ?? null,
        mainFile: projectRef.current?.main ?? null,
        numbering: !!geometryRef.current?.headingNumbering,
      }),
    );
  }, []);
  useEffect(() => {
    if (!editor || !claudeStarted) return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(pushClaudeContext, 250);
    };
    editor.on('selectionUpdate', schedule);
    editor.on('update', schedule);
    pushClaudeContext();
    return () => {
      if (timer) window.clearTimeout(timer);
      editor.off('selectionUpdate', schedule);
      editor.off('update', schedule);
    };
  }, [editor, claudeStarted, path, project, pushClaudeContext]);

  /** Nachricht an Claude abgeschickt: Stand sichern und Kontext sofort aktualisieren. */
  const onClaudeSubmit = useCallback(() => {
    pushClaudeContext();
    if (dirtyRef.current && pathRef.current) void save(false);
  }, [pushClaudeContext, save]);

  // Automatisch sichern: eingeschaltet oder solange Claude Code offen ist (Claude liest die Datei von der Platte)
  const autoSaveOn = !!settings && (settings.autoSave || (settings.showClaude && claudeStarted));
  useEffect(() => {
    if (!autoSaveOn || !dirty || !path || external !== null) return;
    const t = window.setTimeout(() => void save(false), 900);
    return () => window.clearTimeout(t);
  }, [autoSaveOn, dirty, path, external, save]);

  // Breite des Editorbereichs beobachten (für das automatische Einpassen der Seite)
  useEffect(() => {
    const el = editorScroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setEditorWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor, settings === null]);

  // Für Selbsttests (TW_AUTOTEST) und die Entwicklerwerkzeuge
  useEffect(() => {
    (window as unknown as { __tw: unknown }).__tw = { editor, serialize, save, runCommand, loadText, updateSettings, agent: claudeRef };
  }, [editor, serialize, save, runCommand, loadText, updateSettings]);

  useEffect(() => {
    ui.openLink = () => setLinkOpen(true);
    ui.openFind = (replace) => setFind(replace ? 'replace' : 'find');
    registerCodeDialog((r) => setCodeDialog(r));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.action ? 8000 : 3500);
    return () => window.clearTimeout(t);
  }, [toast, setToast]);

  // Fenstertitel-Dokument → Vorschau-Neustart, wenn Eingaben (sys.inputs) wechseln
  const applyInputs = useCallback(
    async (inputs: Record<string, string>) => {
      await window.tw.setInputs(inputs);
      const s = await window.tw.getSettings();
      setSettings(s);
      void runPreview(true);
      void runSnippets(true);
    },
    [runPreview, runSnippets],
  );

  const onSourceChange = useCallback(
    (text: string) => {
      setSourceText(text);
      if (sourceTimer.current) window.clearTimeout(sourceTimer.current);
      sourceTimer.current = window.setTimeout(() => {
        void loadText(text, { markDirty: true, keepScroll: true });
        setDirty(true);
      }, 650);
    },
    [loadText, setDirty],
  );
  const sourceTimer = useRef<number | null>(null);

  // ---------------------------------------------------------------- Layout

  if (!editor || !settings) return <div className="tw-loading">{t('Starting Typewright …')}</div>;

  const g = geometry;
  // Passt die Seite nicht in den Bereich (z. B. Quelltext und Vorschau offen), verkleinern statt abschneiden
  const pagePx = ((g?.pageWidth ?? 595.28) * 4) / 3;
  const zoom = editorWidth ? Math.min(settings.zoom, Math.max(0.3, (editorWidth - 88) / pagePx)) : settings.zoom;
  const pageStyle: React.CSSProperties = g
    ? ({
        '--pw': `${g.pageWidth}pt`,
        '--ph': `${g.pageHeight}pt`,
        '--ml': `${g.marginLeft}pt`,
        '--mr': `${g.marginRight}pt`,
        '--mt': `${g.marginTop}pt`,
        '--mb': `${g.marginBottom}pt`,
        '--font': g.font.map((f) => `"${f}"`).join(', ') + ', "Libertinus Serif", Georgia, serif',
        '--size': `${g.size}pt`,
        '--lh': `${(g.size * 0.72 + g.leading) / g.size}`,
        '--psp': `${Math.max(0, g.spacing - g.leading)}pt`,
        '--ink': g.fill ?? '#000',
        '--align': g.justify ? 'justify' : 'left',
        '--fig-label': g.lang === 'de' ? '"Abbildung: "' : '"Figure: "',
        zoom,
      } as React.CSSProperties)
    : ({ zoom } as React.CSSProperties);

  const errors = preview?.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const pageCount = preview?.pages.length ?? 0;
  const fileName = path ? path.split('/').pop()! : t('Untitled');
  const numbering = g?.headingNumbering ?? null;

  return (
    <div className={`tw-app ${settings.showMarks ? 'show-marks' : ''}`}>
      <TitleBar
        fileName={fileName}
        dirty={dirty}
        path={path}
        mainFile={project?.main && project.main !== path ? project.main : null}
        autoSave={autoSaveOn}
        autoSaveByClaude={!settings.autoSave && autoSaveOn}
        onAutoSave={() => void updateSettings({ autoSave: !settings.autoSave })}
        editor={editor}
        onCommand={(c) => void runCommand(c)}
      />
      <Ribbon
        editor={editor}
        settings={settings}
        geometry={g}
        onCommand={(c) => void runCommand(c)}
        onSettings={updateSettings}
        onBackstage={() => setBackstage(true)}
        onPickImage={pickImage}
        onTable={() => setTableOpen(true)}
        isChapter={!!(project?.main && project.main !== path)}
        mainFile={project?.main ?? null}
      />
      {external !== null && (
        <div className="tw-banner">
          <span>{t('The file was changed outside the editor (e.g. by an AI in the terminal). You have unsaved changes here.')}</span>
          <button
            onClick={() => {
              void loadText(external, { keepScroll: true, smooth: true });
              setExternal(null);
            }}
          >
            {t('Load their version')}
          </button>
          <button
            onClick={() => {
              setExternal(null);
              void save(false, true);
            }}
          >
            {t('Save my version')}
          </button>
        </div>
      )}
      {/* Arbeitsbereich und KI-Terminal stehen immer in dieser Reihenfolge im Baum; die Andockseite
          setzt nur die Flex-Richtung, damit die laufende Sitzung beim Umdocken nicht neu startet */}
      <div className={`tw-main dock-${settings.agentDock}`}>
      <div className="tw-workspace">
        {settings.showNav && <NavPane editor={editor} numbering={numbering} scrollEl={editorScroll} />}
        <div
          className="tw-editor-scroll"
          ref={editorScroll}
          onScroll={(e) => {
            const el = e.currentTarget;
            setScrollFrac(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
            if (anchorFrame.current) cancelAnimationFrame(anchorFrame.current);
            anchorFrame.current = requestAnimationFrame(() => setAnchor(computeAnchor(el)));
          }}
        >
          {find && <FindBar editor={editor} mode={find} onClose={() => setFind(false)} onMode={setFind} />}
          <style>{numberingCss(numbering)}</style>
          <div className={`tw-page ${numbering ? 'numbered' : ''}`} style={pageStyle} lang={g?.lang ?? 'de'}>
            <EditorContent editor={editor} />
          </div>
          <div className="tw-page-foot" />
        </div>
        {settings.showSource && (
          <SourcePane
            text={sourceText}
            onChange={onSourceChange}
            onFocus={(f) => (sourceFocused.current = f)}
            onClose={() => void updateSettings({ showSource: false })}
            diagnostics={preview?.diagnostics ?? []}
            path={path}
          />
        )}
        {settings.showPreview && (
          <PreviewPane
            preview={preview}
            compiling={compiling}
            zoom={settings.previewZoom}
            onZoom={(z) => void updateSettings({ previewZoom: z })}
            onClose={() => void updateSettings({ showPreview: false })}
            anchor={anchor}
            onPage={setCurrentPage}
            mainFile={project?.main && project.main !== path ? project.main : null}
          />
        )}
      </div>
      {(claudeStarted || settings.showClaude) && (
        <ClaudePanel
          visible={settings.showClaude}
          dock={settings.agentDock}
          size={settings.agentDock === 'left' || settings.agentDock === 'right' ? settings.agentWidth : settings.claudeHeight}
          agent={settings.agent}
          customCommand={settings.customCommand}
          onSize={(px) =>
            void updateSettings(settings.agentDock === 'left' || settings.agentDock === 'right' ? { agentWidth: px } : { claudeHeight: px })
          }
          onDock={(d) => void updateSettings({ agentDock: d })}
          onAgent={(a, command) => void updateSettings(command !== undefined ? { agent: a, customCommand: command } : { agent: a })}
          onClose={() => void updateSettings({ showClaude: false })}
          onSendSelection={() => void sendToClaude()}
          onSubmit={onClaudeSubmit}
          onStarted={pushClaudeContext}
          handle={claudeRef}
        />
      )}
      </div>
      {problemsOpen && errors.length > 0 && (
        <Problems
          diagnostics={preview?.diagnostics ?? []}
          onClose={() => setProblemsOpen(false)}
          onShowSource={() => void updateSettings({ showSource: true })}
        />
      )}
      <StatusBar
        page={settings.showPreview && currentPage ? currentPage : pageCount ? Math.min(pageCount, Math.floor(scrollFrac * pageCount) + 1) : 0}
        pages={pageCount}
        words={stats.words}
        chars={stats.chars}
        lang={g?.lang ?? null}
        compiling={compiling}
        ms={preview?.ms ?? null}
        snippetMs={snippetMs}
        errors={errors.length}
        onErrors={() => setProblemsOpen(!problemsOpen)}
        zoom={settings.zoom}
        onZoom={(z) => void updateSettings({ zoom: z })}
        typstVersion={init?.typstVersion ?? null}
        dirty={dirty}
      />
      {toast && (
        <div className="tw-toast">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
      {codeDialog && <CodeDialog request={codeDialog} onClose={() => setCodeDialog(null)} />}
      {linkOpen && <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />}
      {tableOpen && <TableDialog editor={editor} onClose={() => setTableOpen(false)} />}
      {inputsOpen && (
        <InputsDialog
          inputs={(path && settings.inputsByFile[path]) || {}}
          source={sourceText || docRef.current.savedText}
          onSave={(i) => {
            setInputsOpen(false);
            void applyInputs(i);
          }}
          onClose={() => setInputsOpen(false)}
        />
      )}
      {backstage && (
        <Backstage
          path={path}
          project={project}
          settings={settings}
          stats={stats}
          pages={pageCount}
          typstVersion={init?.typstVersion ?? null}
          onClose={() => setBackstage(false)}
          onCommand={(c) => {
            setBackstage(false);
            void runCommand(c);
          }}
          onTemplate={(text) => {
            setBackstage(false);
            if (!path && !dirtyRef.current) void loadText(text).then(() => (docRef.current.savedText = ''));
            else void window.tw.newWindow();
          }}
          onChooseMain={async () => {
            const main = await window.tw.chooseMainFile();
            if (main) {
              await window.tw.setMainFile(main);
              void refreshProject(serialize());
              void runPreview(true);
            }
          }}
          onResetMain={async () => {
            await window.tw.setMainFile(null);
            void refreshProject(serialize());
            void runPreview(true);
          }}
          onSettings={(patch) => void updateSettings(patch)}
        />
      )}
    </div>
  );
}
