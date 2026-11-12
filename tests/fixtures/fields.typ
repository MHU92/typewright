// Eigene Funktionen, deren Text-Argumente im Editor als Felder bearbeitet werden
#set text(lang: "de")

#let accent = rgb("#1E4A7A")
#let section(title) = text(weight: 700, fill: accent, upper(title))
#let entry(when, title, org, body: none) = grid(
  columns: (28mm, 1fr),
  column-gutter: 4mm,
  text(fill: gray, when),
  {
    strong(title)
    linebreak()
    text(fill: accent, org)
    if body != none { body }
  },
)
#let facts(..items) = grid(
  columns: (1fr,) * items.pos().len(),
  ..items.pos().map(((value, label)) => [#text(14pt, value) \ #label]),
)
#let person(info) = [#info.name (#info.role)]
#let note(kind: "info", body) = block(stroke: accent, inset: 6pt, [*#kind:* #body])

#section("Berufserfahrung")

#entry(
  "10/2024 – heute",
  "Gründer & CTO",
  [Reyo (#link("https://example.com")[example.com]) · Berlin],
  body: [
    - Architektur entworfen, darunter #box[Multi-Tenancy],
      SSO und Abrechnung
    - Kennzahl: 2\u{a0}Mrd.\u{a0}€ Umsatz bei #box[Platz 3 bei
      #link("https://example.com/b")[einem Ranking]
      (2024)]
  ],
)

#entry("2021", "Master \"Informatik\"", "Hochschule", body: none)

#facts(
  ("3", [Kunden \ mit Umsatz]),
  ("−75\u{a0}Min.", [je Tag]),
)

#person((name: "Ada", role: "Entwicklerin"))

#note(kind: "Hinweis")[Der Text im Inhaltsblock bleibt editierbar.]
