// Context for the AI in the terminal: which file is open, its outline, where the
// cursor is, what is selected. Claude Code receives it with every message via a
// hook; other tools read the same file on demand.

import type { Editor } from '@tiptap/core';

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) + ' …' : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function buildClaudeContext(editor: Editor, info: { path: string | null; cwd: string | null; mainFile: string | null; numbering: boolean }): string {
  const { doc, selection } = editor.state;
  const lines: string[] = ['<typewright-context>'];
  if (!info.path) {
    lines.push('The editor shows a new document that has not been saved yet. There is no file to edit.');
    lines.push('</typewright-context>');
    return lines.join('\n');
  }
  const rel = info.cwd && info.path.startsWith(info.cwd + '/') ? info.path.slice(info.cwd.length + 1) : info.path;
  lines.push(`Open in the editor (this is "the document"): ${rel}`);
  if (rel !== info.path) lines.push(`Absolute path: ${info.path}`);
  if (info.mainFile && info.mainFile !== info.path) lines.push(`This file is a chapter; the preview compiles the main file ${info.mainFile}.`);

  // Outline with numbers (as shown in the editor)
  const counters = [0, 0, 0, 0, 0, 0];
  const outline: string[] = [];
  const path: { level: number; label: string }[] = [];
  let cursorPath: string[] = [];
  let firstText = '';
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number;
      counters[level - 1]++;
      for (let i = level; i < 6; i++) counters[i] = 0;
      const num = info.numbering ? counters.slice(0, level).join('.') + ' ' : '';
      const label = `${num}${oneLine(node.textContent)}`;
      if (outline.length < 80) outline.push(`${'  '.repeat(level - 1)}- ${label}`);
      while (path.length && path[path.length - 1].level >= level) path.pop();
      path.push({ level, label });
      if (pos < selection.from) cursorPath = path.map((p) => p.label);
      return false;
    }
    if (!firstText && node.isTextblock && node.textContent.trim()) firstText = oneLine(node.textContent);
    return true;
  });
  if (firstText) lines.push(`First visible text (often the title): "${clip(firstText, 160)}"`);
  if (outline.length) {
    lines.push('Outline:');
    lines.push(...outline);
  }

  // Cursor and selection
  const $from = selection.$from;
  let para = '';
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d);
    if (n.isTextblock) {
      para = oneLine(n.textContent);
      break;
    }
  }
  lines.push(cursorPath.length ? `Cursor is in section: ${cursorPath.join(' › ')}` : 'Cursor is before the first heading (start of the document).');
  if (para) lines.push(`Paragraph at the cursor: "${clip(para, 400)}"`);
  if (!selection.empty) {
    const sel = doc.textBetween(selection.from, selection.to, '\n', ' ').trim();
    if (sel) lines.push(`Selected text: "${clip(sel, 2000)}"`);
  } else lines.push('Nothing selected.');
  lines.push('</typewright-context>');
  return lines.join('\n');
}
