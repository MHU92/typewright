// App-Icon: blaues Quadrat, weißes Blatt, Typst-„T“
#set page(width: 1024pt, height: 1024pt, margin: 0pt, fill: none)
#place(top + left, dx: 100pt, dy: 100pt, rect(
  width: 824pt, height: 824pt, radius: 185pt,
  fill: gradient.linear(rgb("#3a6fc4"), rgb("#1e3f73"), angle: 90deg),
))
// Blatt
#place(top + left, dx: 330pt, dy: 215pt, rect(width: 470pt, height: 594pt, radius: 34pt, fill: white))
#for (i, w) in ((0, 330), (1, 300), (2, 330), (3, 250), (4, 330), (5, 280)).map(x => x) {
  place(top + left, dx: 430pt, dy: 300pt + i * 76pt, rect(width: w * 1pt, height: 26pt, radius: 13pt, fill: rgb("#c9d7ee")))
}
// T-Plakette
#place(top + left, dx: 190pt, dy: 330pt, rect(width: 370pt, height: 370pt, radius: 60pt, fill: rgb("#2b579a"), stroke: 14pt + white))
#place(top + left, dx: 190pt, dy: 330pt, box(width: 370pt, height: 370pt, align(center + horizon, text(font: "Inter", weight: 800, size: 300pt, fill: white, baseline: -8pt)[T])))
