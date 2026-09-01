// Verlustfreier Syntaxbaum aus typst-syntax (über den Rust-Helfer `typst-parse`).
// Blatt = [kind, text], innerer Knoten = [kind, [kinder...]].

export type RawCst = [string, string | RawCst[]];

export interface Cst {
  kind: string;
  start: number;
  end: number;
  /** Text bei Blättern, sonst null. */
  leaf: string | null;
  children: Cst[];
}

export function hydrate(raw: RawCst, start = 0): Cst {
  const [kind, body] = raw;
  if (typeof body === 'string') {
    return { kind, start, end: start + body.length, leaf: body, children: [] };
  }
  const children: Cst[] = [];
  let pos = start;
  for (const child of body) {
    const node = hydrate(child, pos);
    children.push(node);
    pos = node.end;
  }
  return { kind, start, end: pos, leaf: null, children };
}

export const TRIVIA = new Set(['Space', 'Parbreak', 'LineComment', 'BlockComment']);

export function nonTrivia(node: Cst): Cst[] {
  return node.children.filter((c) => !TRIVIA.has(c.kind));
}

export function hasError(node: Cst): boolean {
  if (node.kind === 'Error') return true;
  return node.children.some(hasError);
}

/** Aufgeschlüsselter Funktionsaufruf `callee(args)[body]...`. */
export interface CallInfo {
  callee: string;
  calleeNode: Cst;
  args: Cst;
  /** Positionsargumente in den Klammern (ohne Trivia). */
  positional: Cst[];
  /** Benannte Argumente: Name, Wertknoten, ganzer Named-Knoten. */
  named: { name: string; value: Cst; node: Cst }[];
  spread: boolean;
  /** Inhaltsblöcke nach den Klammern. */
  trailing: Cst[];
  /** Klammerteil inkl. `(` `)` oder null. */
  parenStart: number | null;
  parenEnd: number | null;
}

export function callInfo(node: Cst, src: string): CallInfo | null {
  if (node.kind !== 'FuncCall') return null;
  const calleeNode = node.children[0];
  const args = node.children.find((c) => c.kind === 'Args');
  if (!calleeNode || !args) return null;
  if (calleeNode.kind !== 'Ident' && calleeNode.kind !== 'FieldAccess') return null;
  const info: CallInfo = {
    callee: src.slice(calleeNode.start, calleeNode.end),
    calleeNode,
    args,
    positional: [],
    named: [],
    spread: false,
    trailing: [],
    parenStart: null,
    parenEnd: null,
  };
  let inParens = false;
  for (const c of args.children) {
    if (c.kind === 'LeftParen') {
      inParens = true;
      info.parenStart = c.start;
      continue;
    }
    if (c.kind === 'RightParen') {
      inParens = false;
      info.parenEnd = c.end;
      continue;
    }
    if (TRIVIA.has(c.kind) || c.kind === 'Comma') continue;
    if (!inParens) {
      if (c.kind === 'ContentBlock') info.trailing.push(c);
      continue;
    }
    if (c.kind === 'Named') {
      const nameNode = c.children[0];
      const valueNode = nonTrivia(c).slice(2)[0];
      if (!nameNode || !valueNode) return null;
      info.named.push({ name: src.slice(nameNode.start, nameNode.end), value: valueNode, node: c });
    } else if (c.kind === 'Spread') {
      info.spread = true;
    } else {
      info.positional.push(c);
    }
  }
  return info;
}

/** Inhalt der Klammern ohne `(` und `)`, getrimmt; null wenn keine Klammern. */
export function parenInner(info: CallInfo, src: string): string | null {
  if (info.parenStart === null || info.parenEnd === null) return null;
  return src.slice(info.parenStart + 1, info.parenEnd - 1);
}

export function contentMarkup(block: Cst): Cst | null {
  if (block.kind !== 'ContentBlock') return null;
  return block.children.find((c) => c.kind === 'Markup') ?? null;
}
