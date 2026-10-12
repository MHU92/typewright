// Couple the AI in the terminal to the editor: fixed instructions at start, plus the
// current editor context (file, outline, cursor, selection). Claude Code gets the
// context with every message through a UserPromptSubmit hook; Codex reads the same
// context file on demand.

import fs from 'node:fs';
import path from 'node:path';
import { shellQuote } from './terminal';

const SYSTEM_PROMPT = `You are running inside "Typewright", a word processor for Typst files that works like Word. The user sees the document in the editor at the same time. Every change you save to the file appears there immediately and is briefly highlighted; the editor renders the pages and the print preview itself.

How to work here:
- "The document", "the text", "the title", "this paragraph", "the selection", "here" and similar always refer to the file that is open in the editor. Which file that is, where the cursor is and what is selected is provided with every message in the <typewright-context> block. Do not ask which file is meant.
- Edit that .typ file directly with small, targeted changes (Edit tool). Do not reformat anything else and do not change line breaks or indentation outside the affected passage, so the user only sees the real change in the editor.
- "The title" is the visible title of the document (the first large heading or title block at the top). If there is also \`#set document(title: …)\`, update it accordingly.
- "This paragraph", "here" or "this" without further detail refer to the paragraph at the cursor or the selection from the context.
- Do not compile to check your work; the editor does that. Only use \`typst compile\` when the user explicitly asks for a PDF.
- If the file is a chapter (included from a main file), page layout and custom functions come from the main file and its imports.
- Reply briefly, in the language the user writes in.`;

export interface ClaudeFiles {
  contextFile: string;
  /** Full start command (with instructions and hook) when `command` is Claude Code. */
  command: string;
}

export function prepareClaude(tmp: string, command: string): ClaudeFiles {
  const dir = path.join(tmp, 'agent');
  fs.mkdirSync(dir, { recursive: true });
  const contextFile = path.join(dir, 'context.md');
  const systemFile = path.join(dir, 'instructions.md');
  const settingsFile = path.join(dir, 'settings.json');
  if (!fs.existsSync(contextFile)) fs.writeFileSync(contextFile, '');
  fs.writeFileSync(systemFile, SYSTEM_PROMPT);
  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: `cat ${shellQuote(contextFile)} 2>/dev/null; exit 0` }] }],
        },
      },
      null,
      2,
    ),
  );
  const isClaude = /^claude(\s|$)/.test(command.trim());
  const full = isClaude
    ? `${command.trim()} --append-system-prompt "$(cat ${shellQuote(systemFile)})" --settings ${shellQuote(settingsFile)}`
    : command;
  return { contextFile, command: full };
}

/**
 * Codex: every version can start with a first message (`codex "<text>"`). That
 * message carries the same rules as for Claude plus the path of the context file,
 * which the editor keeps up to date; Codex reads it itself when needed.
 */
export function prepareCodex(tmp: string, docPath: string | null): string {
  const dir = path.join(tmp, 'agent');
  fs.mkdirSync(dir, { recursive: true });
  const contextFile = path.join(dir, 'context.md');
  if (!fs.existsSync(contextFile)) fs.writeFileSync(contextFile, '');
  const startFile = path.join(dir, 'codex-start.md');
  const intro = [
    SYSTEM_PROMPT.replace(
      'is provided with every message in the <typewright-context> block',
      `is always up to date in the file ${contextFile}. Read it (e.g. with cat) before you change anything and whenever the user refers to the document, "here", "this paragraph", "the selection" or "the title"`,
    ),
    docPath ? `\nCurrently open: ${docPath}` : '',
    '\nThat was only the setup. Reply with nothing but "Ready." now and wait for the first task.',
  ].join('\n');
  fs.writeFileSync(startFile, intro);
  return `codex "$(cat ${shellQuote(startFile)})"`;
}

export function writeContext(tmp: string, text: string) {
  const file = path.join(tmp, 'agent', 'context.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
