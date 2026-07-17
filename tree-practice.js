/**
 * Interactive parse-tree builder — top-down decomposition mode.
 *
 * Students are shown a root node containing the full formula and work
 * their way down by identifying the main connective at each step.
 *
 * State machine per session:
 *   pending  → the node hasn't been touched yet
 *   active   → the node is currently focused (student must identify its connective)
 *   done     → the node has been correctly decomposed (or is a leaf)
 *   error    → the student just gave a wrong answer (briefly; resets to active)
 *
 * The practice area renders as an SVG (matching the viewer tree style).
 * Each box is a <foreignObject> so we can attach click listeners easily;
 * but to keep things consistent with the viewer, we use SVG rects + text
 * and attach click listeners to the SVG <g> elements.
 *
 * Flow:
 *   startPractice(ast) — initialise with a parsed AST
 *   Each node begins as pending.
 *   The topmost unfinished node is activated.
 *   When activated, the node's box is highlighted and the connective buttons
 *   in the toolbar glow.  The student clicks a button (or 'atom' if it's a
 *   letter).  Correct → split; wrong → shake.
 *   When all nodes are done → completion banner.
 */

'use strict';

// ── Geometry (match viewer) ───────────────────────────────────────────────────
const PT_PAD_X   = 12;
const PT_PAD_Y   = 7;
const PT_FONT_SZ = 13;
const PT_V_GAP   = 48;
const PT_H_GAP   = 16;

// ── Node state ────────────────────────────────────────────────────────────────
const ST_PENDING = 'pending';
const ST_ACTIVE  = 'active';
const ST_DONE    = 'done';
const ST_ERROR   = 'error';

// ── Practice session state ────────────────────────────────────────────────────
let _ptAst         = null;   // the AST being practiced
let _ptNodes       = [];     // flat list of all nodes, top-down left-to-right
let _ptActive      = null;   // currently active node (or null)
let _ptDone        = false;  // session complete?
let _ptSvgEl       = null;   // <svg> element we're drawing into
let _ptNodeMap     = new Map(); // AST node → { g, rect, text }

// Colours (CSS vars; resolved at paint time)
const COLOR_ACTIVE   = 'var(--color-practice-active, #1565c0)';
const COLOR_PENDING  = 'var(--color-border)';
const COLOR_DONE_LEAF = 'var(--color-teal)';
const COLOR_DONE_CMPD = 'var(--color-primary)';
const COLOR_ERROR    = 'var(--color-false, #b71c1c)';

// ── Children helper (same as viewer) ─────────────────────────────────────────
function ptChildren(node) {
  if (node.type === 'letter') return [];
  if (node.type === 'neg')    return [node.arg];
  return [node.left, node.right];
}

// ── Flatten AST top-down breadth-first ───────────────────────────────────────
function flattenBFS(root) {
  const out = [];
  const q = [root];
  while (q.length) {
    const n = q.shift();
    out.push(n);
    ptChildren(n).forEach(c => q.push(c));
  }
  return out;
}

// ── What connective does this node introduce? ─────────────────────────────────
function mainConnective(node) {
  switch (node.type) {
    case 'letter': return 'atom';
    case 'neg':    return '¬';
    case 'and':    return '∧';
    case 'or':     return '∨';
    case 'imp':    return '→';
    default:       return null;
  }
}

// ── Layout (reuse viewer logic) ───────────────────────────────────────────────
let _ptMeasCtx = null;
function ptMeasure(text) {
  if (!_ptMeasCtx) {
    _ptMeasCtx = document.createElement('canvas').getContext('2d');
  }
  _ptMeasCtx.font = `${PT_FONT_SZ}px "Consolas","Liberation Mono",Menlo,Courier,monospace`;
  return _ptMeasCtx.measureText(text).width;
}

function ptBoxSize(node, isRoot) {
  const label = prettyPrint(node, isRoot);
  const w = Math.ceil(ptMeasure(label)) + PT_PAD_X * 2;
  const h = PT_FONT_SZ + PT_PAD_Y * 2;
  return { w, h, label };
}

function ptComputeLayout(root) {
  function sizeNode(node, isRoot) {
    const { w, h, label } = ptBoxSize(node, isRoot);
    node._ptW = w; node._ptH = h; node._ptLabel = label;
    ptChildren(node).forEach(c => sizeNode(c, false));
  }
  sizeNode(root, true);

  function subtreeW(node) {
    const ch = ptChildren(node);
    if (!ch.length) { node._ptSubW = node._ptW; return node._ptW; }
    const total = ch.reduce((s, c) => s + subtreeW(c), 0) + (ch.length - 1) * PT_H_GAP;
    node._ptSubW = Math.max(node._ptW, total);
    return node._ptSubW;
  }
  subtreeW(root);

  const pos = new Map();
  function assign(node, cx, depth) {
    const y = depth * (PT_FONT_SZ + PT_PAD_Y * 2 + PT_V_GAP);
    const x = cx - node._ptW / 2;
    pos.set(node, { x, y, w: node._ptW, h: node._ptH });
    const ch = ptChildren(node);
    if (!ch.length) return;
    const totalW = ch.reduce((s, c) => s + c._ptSubW, 0) + (ch.length - 1) * PT_H_GAP;
    let cur = cx - totalW / 2;
    ch.forEach(c => {
      assign(c, cur + c._ptSubW / 2, depth + 1);
      cur += c._ptSubW + PT_H_GAP;
    });
  }
  assign(root, root._ptSubW / 2, 0);
  return pos;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
function ptSvgEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// ── Node colour by state ──────────────────────────────────────────────────────
function nodeColor(node, state) {
  if (state === ST_ACTIVE)  return COLOR_ACTIVE;
  if (state === ST_ERROR)   return COLOR_ERROR;
  if (state === ST_DONE) {
    return node.type === 'letter' ? COLOR_DONE_LEAF : COLOR_DONE_CMPD;
  }
  return COLOR_PENDING;
}

// ── Render / re-render ────────────────────────────────────────────────────────
function ptRender() {
  if (!_ptAst || !_ptSvgEl) return;

  const svg = _ptSvgEl;
  svg.innerHTML = '';

  // Only show nodes that have been "revealed" (done or active)
  // pending nodes are invisible until their parent is done
  const revealed = new Set();
  function markRevealed(node) {
    const st = node._ptState;
    if (st === ST_DONE || st === ST_ACTIVE || st === ST_ERROR) {
      revealed.add(node);
      // If done (split), also show children as revealed-pending
      if (st === ST_DONE) {
        ptChildren(node).forEach(c => {
          revealed.add(c);
          // But don't recurse — children reveal their own subtrees when they're done
        });
      }
    }
  }
  flattenBFS(_ptAst).forEach(n => markRevealed(n));

  const pos = ptComputeLayout(_ptAst);
  const MARGIN = 16;
  let maxX = 0, maxY = 0;
  for (const [n, { x, y, w, h }] of pos) {
    if (revealed.has(n)) {
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
  }
  svg.setAttribute('width', maxX + MARGIN * 2);
  svg.setAttribute('height', maxY + MARGIN * 2);

  const edgeG = ptSvgEl('g', { transform: `translate(${MARGIN},${MARGIN})` });
  const nodeG = ptSvgEl('g', { transform: `translate(${MARGIN},${MARGIN})` });
  svg.appendChild(edgeG);
  svg.appendChild(nodeG);

  _ptNodeMap = new Map();

  function draw(node) {
    if (!revealed.has(node)) return;
    const p = pos.get(node);
    const st = node._ptState;
    const color = nodeColor(node, st);
    const isDone = st === ST_DONE;
    const isActive = st === ST_ACTIVE || st === ST_ERROR;

    // Edges to revealed children
    ptChildren(node).forEach(child => {
      if (revealed.has(child)) {
        const cp = pos.get(child);
        edgeG.appendChild(ptSvgEl('line', {
          x1: p.x + p.w / 2, y1: p.y + p.h,
          x2: cp.x + cp.w / 2, y2: cp.y,
          stroke: 'var(--color-border)',
          'stroke-width': '1.5',
        }));
        draw(child);
      }
    });

    const g = ptSvgEl('g', {
      class: `pt-node pt-node-${st}${isActive ? ' pt-node-active' : ''}`,
      style: 'cursor: ' + (isActive ? 'default' : 'default') + ';',
    });

    const strokeW = isActive ? '2.5' : '1.8';
    const fillColor = isActive
      ? 'var(--color-practice-active-bg, #e8f0fe)'
      : 'var(--color-surface)';

    g.appendChild(ptSvgEl('rect', {
      x: p.x, y: p.y, width: p.w, height: p.h,
      rx: 5, ry: 5,
      fill: isDone ? 'var(--color-surface)' : fillColor,
      stroke: color,
      'stroke-width': strokeW,
    }));

    g.appendChild(ptSvgEl('text', {
      x: p.x + p.w / 2,
      y: p.y + p.h / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': 'var(--font-mono)',
      'font-size': PT_FONT_SZ,
      fill: isDone
        ? (node.type === 'letter' ? 'var(--color-teal)' : 'var(--color-primary)')
        : (isActive ? COLOR_ACTIVE : 'var(--color-text-muted)'),
    }, node._ptLabel));

    // Downward arrow above the active node
    if (isActive) {
      g.appendChild(ptSvgEl('text', {
        x: p.x + p.w / 2,
        y: p.y - 4,
        'text-anchor': 'middle',
        'font-size': '9',
        fill: COLOR_ACTIVE,
        class: 'pt-active-arrow',
      }, '▼'));
    }

    nodeG.appendChild(g);
    _ptNodeMap.set(node, { g });
  }

  draw(_ptAst);
  ptUpdateToolbar();
}

// ── Start a new practice session ──────────────────────────────────────────────
function startPractice(ast) {
  _ptAst   = ast;
  _ptDone  = false;
  _ptSvgEl = document.getElementById('practice-svg');
  _ptNodeMap = new Map();

  // Initialise all nodes to pending
  flattenBFS(ast).forEach(n => { n._ptState = ST_PENDING; });

  // Activate the root
  ast._ptState = ST_ACTIVE;
  _ptActive = ast;

  ptRender();
  ptUpdateStatus('Click the connective buttons to identify the main connective of the highlighted node.');
  ptSetDone(false);
  document.getElementById('practice-solution-btn') && (
    document.getElementById('practice-solution-btn').hidden = true
  );
}

// ── Respond to a connective button click ──────────────────────────────────────
function practiceAnswer(conn) {
  if (!_ptActive || _ptDone) return;
  const node = _ptActive;
  const correct = mainConnective(node);

  if (conn === correct) {
    // Mark node done
    node._ptState = ST_DONE;

    const ch = ptChildren(node);

    if (ch.length === 0) {
      // Leaf — just advance
    } else {
      // Reveal children as pending
      ch.forEach(c => { c._ptState = ST_PENDING; });
    }

    // Find next active: leftmost pending node (BFS order)
    const allNodes = flattenBFS(_ptAst);
    const nextPending = allNodes.find(n => n._ptState === ST_PENDING);

    if (nextPending) {
      nextPending._ptState = ST_ACTIVE;
      _ptActive = nextPending;
      ptUpdateStatus('Good! Now identify the main connective of the highlighted node.');
    } else {
      // All done
      _ptActive = null;
      _ptDone = true;
      ptRender();
      ptSetDone(true);
      ptUpdateStatus('');
      return;
    }
  } else {
    // Wrong answer — flash error
    node._ptState = ST_ERROR;
    ptRender();
    ptUpdateStatus('Not quite — that\'s not the main connective. Try again.');
    setTimeout(() => {
      if (node._ptState === ST_ERROR) {
        node._ptState = ST_ACTIVE;
        ptRender();
        ptUpdateStatus('Identify the main connective of the highlighted node.');
      }
    }, 800);
    return;
  }

  ptRender();
}

// ── Update the connective toolbar state ───────────────────────────────────────
function ptUpdateToolbar() {
  const btns = document.querySelectorAll('.pt-conn-btn');
  btns.forEach(btn => {
    btn.disabled = !_ptActive || _ptDone;
    btn.classList.toggle('pt-conn-active', Boolean(_ptActive && !_ptDone));
  });

  // Atom button: only enabled when active node is a letter
  const atomBtn = document.getElementById('pt-atom-btn');
  if (atomBtn) {
    atomBtn.disabled = !_ptActive || _ptDone;
    atomBtn.classList.toggle('pt-conn-active', Boolean(_ptActive && !_ptDone));
  }
}

// ── Status message ────────────────────────────────────────────────────────────
function ptUpdateStatus(msg) {
  const el = document.getElementById('practice-status');
  if (el) el.textContent = msg;
}

// ── Completion state ──────────────────────────────────────────────────────────
function ptSetDone(done) {
  const banner = document.getElementById('practice-complete-banner');
  const solBtn = document.getElementById('practice-solution-btn');
  const solRow = document.getElementById('practice-solution-row');
  if (banner) banner.hidden = !done;
  if (solBtn) solBtn.hidden = !done;
  if (solRow) solRow.hidden = !done;
  ptUpdateToolbar();
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetPractice() {
  if (_ptAst) startPractice(_ptAst);
}
