// parser.js — Propositional Logic formula parser
// Vocabulary: sentence letters p,q,r,s,t (with optional numeric subscripts)
// Connectives: ¬ ∧ ∨ →
// Parentheses: ( )

// ── ASCII normalisation ───────────────────────────────────────────────────────
function normaliseInput(raw) {
  return raw
    .replace(/=>/g, '→')
    .replace(/->/g, '→')
    .replace(/\/\\/g, '∧')
    .replace(/\\\//g, '∨')
    .replace(/&/g, '∧')
    .replace(/\|/g, '∨')
    .replace(/~/g, '¬')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tokeniser ─────────────────────────────────────────────────────────────────
function tokenise(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ') { i++; continue; }
    if (ch === '¬') { tokens.push({ type: 'NEG', val: '¬' }); i++; continue; }
    if (ch === '∧') { tokens.push({ type: 'AND', val: '∧' }); i++; continue; }
    if (ch === '∨') { tokens.push({ type: 'OR',  val: '∨' }); i++; continue; }
    if (ch === '→') { tokens.push({ type: 'IMP', val: '→' }); i++; continue; }
    if (ch === '(') { tokens.push({ type: 'LPAREN', val: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN', val: ')' }); i++; continue; }
    // Sentence letter: p,q,r,s,t with optional numeric subscript
    if (/[pqrst]/.test(ch)) {
      let letter = ch; i++;
      let subscript = '';
      while (i < input.length && /[0-9]/.test(input[i])) {
        subscript += input[i]; i++;
      }
      tokens.push({ type: 'LETTER', val: letter + subscript });
      continue;
    }
    tokens.push({ type: 'UNKNOWN', val: ch }); i++;
  }
  return tokens;
}

// ── Recursive-descent parser ──────────────────────────────────────────────────
// Grammar (official):
//   formula  ::= LETTER | '¬' formula | '(' formula BINOP formula ')'
//   BINOP    ::= '∧' | '∨' | '→'
//
// Unofficial: outermost parens may be omitted for a binary formula.

function parse(tokens) {
  let pos = 0;

  function peek()    { return tokens[pos]; }
  function consume() { return tokens[pos++]; }
  function atEnd()   { return pos >= tokens.length; }

  function parseFormula(allowUnofficial) {
    const tok = peek();
    if (!tok) return null;

    // Negation
    if (tok.type === 'NEG') {
      consume();
      const sub = parseFormula(false);
      if (!sub) return null;
      return { type: 'NEG', sub, str: '¬' + sub.str, official: sub.official };
    }

    // Parenthesised binary
    if (tok.type === 'LPAREN') {
      consume();
      const left = parseFormula(false);
      if (!left) return null;
      const op = peek();
      if (!op || !['AND','OR','IMP'].includes(op.type)) return null;
      consume();
      const right = parseFormula(false);
      if (!right) return null;
      const rp = peek();
      if (!rp || rp.type !== 'RPAREN') return null;
      consume();
      const opStr = op.val;
      return {
        type: op.type,
        left, right,
        str: '(' + left.str + opStr + right.str + ')',
        official: true,
      };
    }

    // Sentence letter
    if (tok.type === 'LETTER') {
      consume();
      return { type: 'LETTER', val: tok.val, str: tok.val, official: true };
    }

    return null;
  }

  // First try official parse
  const tree = parseFormula(false);
  if (!tree || !atEnd()) {
    // Try unofficial: binary formula without outermost parens
    pos = 0;
    const left = parseFormula(false);
    if (!left) return { ok: false };
    const op = peek();
    if (!op || !['AND','OR','IMP'].includes(op.type)) return { ok: false };
    consume();
    const right = parseFormula(false);
    if (!right || !atEnd()) return { ok: false };
    const opStr = op.val;
    return {
      ok: true,
      official: false,
      tree: {
        type: op.type,
        left, right,
        str: left.str + opStr + right.str,
        official: false,
      },
      officialStr: '(' + left.str + opStr + right.str + ')',
    };
  }

  return { ok: true, official: true, tree, officialStr: tree.str };
}

// ── Public API ────────────────────────────────────────────────────────────────
function parseFormula(raw) {
  const norm = normaliseInput(raw);
  if (!norm) return { ok: false, norm: '' };
  const tokens = tokenise(norm);
  if (tokens.some(t => t.type === 'UNKNOWN')) return { ok: false, norm };
  const result = parse(tokens);
  return { ...result, norm };
}

// ── Sentence letters ──────────────────────────────────────────────────────────
function getLetters(tree) {
  if (!tree) return new Set();
  if (tree.type === 'LETTER') return new Set([tree.val]);
  if (tree.type === 'NEG') return getLetters(tree.sub);
  return new Set([...getLetters(tree.left), ...getLetters(tree.right)]);
}

// ── Truth evaluator ───────────────────────────────────────────────────────────
function evaluate(tree, assignment) {
  if (!tree) return null;
  if (tree.type === 'LETTER') return assignment[tree.val] === true;
  if (tree.type === 'NEG') return !evaluate(tree.sub, assignment);
  if (tree.type === 'AND') return evaluate(tree.left, assignment) && evaluate(tree.right, assignment);
  if (tree.type === 'OR')  return evaluate(tree.left, assignment) || evaluate(tree.right, assignment);
  if (tree.type === 'IMP') return !evaluate(tree.left, assignment) || evaluate(tree.right, assignment);
  return null;
}
