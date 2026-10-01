// Templates for new documents, in the UI language.

import { getLang } from '../i18n';

export interface Template {
  id: string;
  name: string;
  description: string;
  text: string;
}

const EN: Template[] = [
  {
    id: 'blank',
    name: 'Blank document',
    description: 'A4, English hyphenation',
    text: `#set page(paper: "a4")
#set text(lang: "en")

`,
  },
  {
    id: 'report',
    name: 'Report',
    description: 'Numbered headings, table of contents',
    text: `#set document(title: "Report")
#set page(paper: "a4", margin: (x: 2.2cm, y: 2.5cm), numbering: "1")
#set text(size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.7em)
#set heading(numbering: "1.1")

#align(center)[#text(size: 22pt, weight: "bold")[Report title]]

#outline()

= Introduction

The report starts here.

= Results

== First result

Text about the first result.
`,
  },
  {
    id: 'letter',
    name: 'Letter',
    description: 'Sender, recipient, date',
    text: `#set page(paper: "a4", margin: (left: 2.5cm, right: 2cm, top: 2.7cm, bottom: 2cm))
#set text(size: 10.5pt, lang: "en")
#set par(leading: 0.65em)

#text(size: 8pt)[Sender Ltd · 1 Main Street · Springfield]

Recipient Inc. \\
Attn. Jane Doe \\
2 High Street \\
Springfield

#align(right)[Springfield, 1 January 2027]

*Subject of the letter*

Dear Ms Doe,

the text of the letter goes here.

Kind regards

John Smith
`,
  },
  {
    id: 'memo',
    name: 'Note',
    description: 'Plain and simple',
    text: `#set page(paper: "a4", margin: 2cm)
#set text(size: 11pt, lang: "en")

= Note

- First point
- Second point
`,
  },
];

const DE: Template[] = [
  {
    id: 'blank',
    name: 'Leeres Dokument',
    description: 'A4, deutsche Silbentrennung',
    text: `#set page(paper: "a4")
#set text(lang: "de")

`,
  },
  {
    id: 'report',
    name: 'Bericht',
    description: 'Nummerierte Überschriften, Inhaltsverzeichnis',
    text: `#set document(title: "Bericht")
#set page(paper: "a4", margin: (x: 2.2cm, y: 2.5cm), numbering: "1")
#set text(size: 10.5pt, lang: "de")
#set par(justify: true, leading: 0.7em)
#set heading(numbering: "1.1")

#align(center)[#text(size: 22pt, weight: "bold")[Titel des Berichts]]

#outline()

= Einleitung

Hier beginnt der Bericht.

= Ergebnisse

== Erstes Ergebnis

Text zum ersten Ergebnis.
`,
  },
  {
    id: 'letter',
    name: 'Brief',
    description: 'DIN-5008-nah, Absender und Empfänger',
    text: `#set page(paper: "a4", margin: (left: 2.5cm, right: 2cm, top: 2.7cm, bottom: 2cm))
#set text(size: 10.5pt, lang: "de")
#set par(leading: 0.65em)

#text(size: 8pt)[Absender GmbH · Straße 1 · 12345 Stadt]

Empfänger GmbH \\
z. Hd. Frau Muster \\
Straße 2 \\
12345 Stadt

#align(right)[Stadt, 1. Januar 2027]

*Betreff des Schreibens*

Sehr geehrte Frau Muster,

hier steht der Text des Briefes.

Mit freundlichen Grüßen

Max Mustermann
`,
  },
  {
    id: 'memo',
    name: 'Notiz',
    description: 'Schlicht und einfach',
    text: `#set page(paper: "a4", margin: 2cm)
#set text(size: 11pt, lang: "de")

= Notiz

- Erster Punkt
- Zweiter Punkt
`,
  },
];

export function getTemplates(): Template[] {
  return getLang() === 'de' ? DE : EN;
}
