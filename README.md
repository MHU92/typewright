# Typewright

**A word processor for [Typst](https://typst.app).** Open any `.typ` file and edit it like a Word document: pages with real margins and fonts, a ribbon, styles, tables, pictures, footnotes, find & replace, spell checking. Next to it, the real Typst output as a live print preview. And if you like, Claude Code or Codex right inside the window.

![Typewright editing a Typst document, with navigation pane and live print preview](docs/screenshot.png)

## Why

Typst is a joy to write, and it turns out AI assistants write excellent Typst too. But not every change needs code or an AI: sometimes you just want to fix a sentence, swap a term or highlight something. Typewright gives you a familiar word-processor view of the very same `.typ` file, while the AI (or you, in the source view) works on the text underneath.

The file stays the source of truth. Parts the editor doesn't understand as plain text (your own functions, templates, diagrams) stay Typst code and are rendered exactly as they appear in the PDF. When you save, everything you didn't touch is written back character for character, so a diff only ever shows what you actually changed.

## Built on Typst ❤️

Typewright exists because Typst is wonderful, and all the hard typesetting work is Typst's:

- Documents are parsed with Typst's own parser, the [`typst-syntax`](https://crates.io/crates/typst-syntax) crate, so the editor sees exactly what Typst sees.
- Every page in the preview, every rendered snippet in the editor and every exported PDF comes from the Typst compiler itself.

Huge thanks to Laurenz Mädje, Martin Haug and everyone who builds Typst. If you enjoy Typewright, please support Typst: use [the Typst web app](https://typst.app), contribute to [typst/typst](https://github.com/typst/typst) and share packages on [Typst Universe](https://typst.app/universe).

*Typst is a trademark of Typst GmbH. Typewright is an independent, non-commercial open-source project and is not affiliated with or endorsed by Typst GmbH.*

## Features

- **Word-like editing:** paragraphs, headings, lists, tables (merge, header rows), pictures and figures, links, footnotes, cross-references, equations, code blocks, page breaks, table of contents.
- **Formatting that maps to Typst:** bold, italic, underline, strikethrough, sub/superscript, small caps, font, size, color and highlight become `*…*`, `#text(…)[…]`, `#highlight[…]` and friends.
- **Document layout** (Layout tab): paper size, orientation, margins, columns, header and footer, page numbers, default font and size, language, justification, line and paragraph spacing, heading numbering. These are written as `#set` rules in your document's template.
- **Your own functions stay yours:** text inside `#callout[…]`, `#txt[…]` and the like stays editable; code-only calls such as charts are rendered by Typst right in the page.
- **Live print preview** that follows your scroll position, plus page count, word count and compile errors.
- **Multi-file projects:** a chapter included via `#include` is previewed through its main file, with the main file's template.
- **Typst source view** side by side; edits there apply immediately.
- **AutoSave**, conflict protection and live reload when the file changes on disk.
- **English and German** user interface (File → Options).

## Install

Typewright currently targets **macOS** (Apple Silicon). There are no prebuilt downloads yet, so build it from source:

```sh
brew install typst          # the Typst CLI (Typewright uses it for preview and export)
# Node.js 22 and a Rust toolchain are also required

git clone https://github.com/MHU92/typewright.git
cd typewright
npm install
npm run dist                # → release/mac-arm64/Typewright.app
```

Copy `Typewright.app` to `~/Applications` or `/Applications` and open `.typ` files with it (Finder → Open With).

For development: `npm run build:native` once, then `npm run dev` (Vite + Electron with live reload).

## License

[Apache License 2.0](LICENSE), the same license as Typst. See [NOTICE](NOTICE) for third-party credits.
