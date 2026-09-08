// Testdokument mit möglichst vielen Konstrukten
#set page(paper: "a4", margin: 2cm)
#set text(lang: "de", size: 11pt)
#set heading(numbering: "1.")

#outline()

= Einleitung <intro>

Das ist *fett*, _kursiv_ und *_beides_*. Ein `code` und ein Link auf https://typst.app sowie #link("https://example.org")[Beispiel].
Zweite Zeile im selben Absatz mit Escape \# und \@ sowie ~ geschütztem Leerzeichen -- Gedankenstrich.

#underline[Unterstrichen], #strike[durch], x#super[2] und H#sub[2]O, #highlight[markiert] und #text(fill: red, size: 14pt)[rot groß].
Wort#strong[fett]wort und #emph[kursiv]wort. Fußnote#footnote[Eine Fußnote mit *Fett*.] hier.

== Listen

- Punkt eins
- Punkt zwei
  - Unterpunkt
  - Noch einer
- Punkt drei

+ Erstens
+ Zweitens

1. Explizit
2. Nummeriert

#align(center)[Zentrierter Text]

#par(justify: true)[Blocksatz-Absatz mit etwas mehr Text, damit man es sieht.]

== Tabellen

#table(
  columns: (1fr, 2fr),
  align: left,
  table.header([*Kopf A*], [*Kopf B*]),
  [a1], [b1],
  table.cell(colspan: 2)[über zwei Spalten],
  "Text", [b3],
)

#figure(
  image("pixel.png", width: 20%),
  caption: [Eine Abbildung],
) <fig:pixel>

Siehe @fig:pixel und @intro.

$ sum_(i=1)^n i = (n(n+1))/2 $

Inline-Mathe $a^2 + b^2 = c^2$ im Satz.

```python
def hallo():
    return "welt"
```

#quote(block: true)[Ein Zitat über mehrere Wörter.]

#let farbe = rgb("#2b579a")
#text(fill: farbe)[Variable Farbe]

#line(length: 100%)

#pagebreak()

Letzter Absatz \
mit Zeilenumbruch.
