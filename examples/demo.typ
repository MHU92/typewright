// Demo document for the README screenshot.
#let accent = rgb("#2b579a")
#let callout(body) = block(fill: accent.lighten(88%), stroke: (left: 2pt + accent), inset: 10pt, width: 100%, body)
#let bars(..data) = {
  let items = data.pos()
  let top = calc.max(..items.map(x => x.at(1)))
  grid(
    columns: items.len(),
    column-gutter: 10pt,
    align: bottom,
    ..items.map(((label, value)) => stack(
      spacing: 4pt,
      align(center, text(size: 8pt)[#value]),
      rect(width: 100%, height: value / top * 70pt, fill: accent.lighten(20%), radius: (top: 3pt)),
      align(center, text(size: 8pt, fill: luma(90))[#label]),
    )),
  )
}

#set document(title: "Field Notes on Typesetting")
#set page(paper: "a4", margin: (x: 2.4cm, y: 2.6cm), numbering: "1")
#set text(size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.68em)
#set heading(numbering: "1.1")
#show heading.where(level: 1): set text(fill: accent)

#text(size: 22pt, weight: "bold")[Field Notes on Typesetting]

#text(fill: luma(90))[A small showcase of what this editor can do with a plain `.typ` file.]

#callout[
  *Everything here is a real Typst document.* Paragraphs, lists and tables are edited like in a word processor; custom functions such as this callout keep their text editable, and anything else is rendered by Typst itself.
]

= Why Typst

Typst is a modern markup-based typesetting system. It compiles in milliseconds, its syntax is readable#footnote[Which also makes it a great format for AI assistants.], and its scripting language makes templates easy to write.

- *Fast:* incremental compilation, instant previews
- *Readable:* markup for text, code for logic
- *Powerful:* show rules, functions, packages

== Numbers at a glance

#bars(("Q1", 12), ("Q2", 19), ("Q3", 27), ("Q4", 34))

#table(
  columns: (1fr, auto, auto),
  table.header([*Quarter*], [*Pages*], [*Compile time*]),
  [Q1], [12], [80 ms],
  [Q2], [19], [95 ms],
  [Q3], [27], [110 ms],
)

== A formula

The area of a circle follows directly from integrating its circumference:

$ A = integral_0^r 2 pi rho dif rho = pi r^2 $

#quote(block: true)[Good typography is invisible. Bad typography is everywhere.]
