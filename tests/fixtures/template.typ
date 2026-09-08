// Eigene Vorlage mit Funktionen, wie sie KI-Assistenten gern schreiben
#let akzent = rgb("#2b579a")
#let preis(n) = [#n~€]
#let hinweis(body) = block(fill: akzent.lighten(85%), inset: 8pt, radius: 4pt, width: 100%, body)
#let karte(titel, body) = block(stroke: 0.5pt + akzent, inset: 10pt, radius: 6pt, width: 100%)[*#titel* \ #body]
#let offen(body) = box(fill: yellow.lighten(60%), inset: (x: 2pt), body)
#let kennzahlen(..zahlen) = grid(
  columns: zahlen.pos().len(),
  gutter: 8pt,
  ..zahlen.pos().map(z => block(fill: luma(240), inset: 8pt, radius: 4pt, width: 100%)[
    #text(size: 16pt, weight: "bold")[#z.at(0)] \
    #text(size: 8pt)[#z.at(1)]
  ]),
)

#set page(paper: "a4", margin: (x: 2.2cm, y: 2.5cm), numbering: "1 / 1")
#set text(size: 10.5pt, lang: "de")
#set par(justify: true)
#set heading(numbering: "1.1")
#show heading.where(level: 1): set text(fill: akzent)

= Angebot

#hinweis[
Dieses Angebot gilt bis zum 31.12. Die Preise verstehen sich netto.

Ein zweiter Absatz im Hinweis mit *Betonung* und einem Preis von #preis(1200).
]

#kennzahlen(("12", "Monate"), ("3", "Nutzer"), ("99 %", "Verfügbarkeit"))

== Leistungen

- Einrichtung der Umgebung, Preis #offen[noch offen]
- Schulung für #preis(450) pro Tag
  + Grundlagen
  + Fortgeschrittene Themen

#karte("Hinweis")[Der Text in der Karte bleibt im Editor editierbar.]

/ Begriff: Erklärung in einer Begriffsliste

#figure(
  table(columns: 3, [A], [B], [C], [1], [2], [3]),
  caption: [Eine Tabelle in einer Abbildung],
) <tab:beispiel>

Siehe @tab:beispiel.

// Ein Kommentar zwischen den Absätzen

#pagebreak()

#align(right)[Ort, Datum]
