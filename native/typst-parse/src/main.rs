//! Reads one JSON object {"id": n, "text": "..."} per line from stdin and writes
//! {"id": n, "tree": [...]} per line to stdout. The tree is the lossless syntax tree
//! from Typst's official parser (typst-syntax): leaf = [kind, text], inner node = [kind, [children...]].

use std::io::{self, BufRead, Write};

use serde_json::{json, Value};
use typst_syntax::SyntaxNode;

fn encode(node: &SyntaxNode) -> Value {
    let kind = format!("{:?}", node.kind());
    if node.children().len() == 0 {
        json!([kind, node.full_text().to_string()])
    } else {
        let children: Vec<Value> = node.children().map(encode).collect();
        json!([kind, children])
    }
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(req) => {
                let id = req.get("id").cloned().unwrap_or(Value::Null);
                let text = req.get("text").and_then(Value::as_str).unwrap_or("");
                let mode = req.get("mode").and_then(Value::as_str).unwrap_or("markup");
                let root = match mode {
                    "code" => typst_syntax::parse_code(text),
                    "math" => typst_syntax::parse_math(text),
                    _ => typst_syntax::parse(text),
                };
                json!({ "id": id, "tree": encode(&root) })
            }
            Err(err) => json!({ "id": null, "error": err.to_string() }),
        };
        let _ = writeln!(out, "{}", response);
        let _ = out.flush();
    }
}
