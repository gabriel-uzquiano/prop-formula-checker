/**
 * Parse tree renderer for propositional logic.
 *
 * Each node displays the full subformula it represents.
 * Layout is top-down: root at top, leaves at bottom.
 *
 * Node colors:
 *   - Atomic (letter): teal border
 *   - Compound (negation / binary): maroon border
 */

const PAD_X   = 12;
const PAD_Y   = 7;
const FONT_SZ = 13;
const V_GAP   = 48;
const H_GAP   = 16;

function nodeLabel(node, isRoot = false) {
  return prettyPrint(node, isRoot);
}

function children(node) {
  if (node.type === 'letter') return [];
  if (node.type === 'neg')    return [node.arg];
  return [node.left, node.right];
}

let _measureCtx = null;
function measureText(text) {
  if (!_measureCtx) {
    const c = document.createElement('canvas');
    _measureCtx = c.getContext('2d');
  }
  _measureCtx.font = `${FONT_SZ}px "Consolas", "Liberation Mono", Menlo, Courier, monospace`;
  return _measureCtx.measureText(text).width;
}

function boxSize(node, isRoot = false) {
  const label = nodeLabel(node, isRoot);
  const w = Math.ceil(measureText(label)) + PAD_X * 2;
  const h = FONT_SZ + PAD_Y * 2;
  return { w, h, label };
}

function computeLayout(root) {
  function annotate(node, isRoot) {
    const { w, h, label } = boxSize(node, isRoot);
    node._w = w; node._h = h; node._label = label;
    children(node).forEach(c => annotate(c, false));
  }
  annotate(root, true);

  function subtreeWidth(node) {
    const ch = children(node);
    if (ch.length === 0) {
      node._subtreeW = node._w;
    } else {
      const chTotal = ch.reduce((s, c) => s + subtreeWidth(c), 0)
                    + (ch.length - 1) * H_GAP;
      node._subtreeW = Math.max(node._w, chTotal);
    }
    return node._subtreeW;
  }
  subtreeWidth(root);

  const positions = new Map();

  function assign(node, xCenter, depth) {
    const y = depth * (FONT_SZ + PAD_Y * 2 + V_GAP);
    const x = xCenter - node._w / 2;
    positions.set(node, { x, y, w: node._w, h: node._h, label: node._label });

    const ch = children(node);
    if (ch.length === 0) return;

    const totalChildW = ch.reduce((s, c) => s + c._subtreeW, 0)
                      + (ch.length - 1) * H_GAP;
    let cursor = xCenter - totalChildW / 2;
    ch.forEach(child => {
      assign(child, cursor + child._subtreeW / 2, depth + 1);
      cursor += child._subtreeW + H_GAP;
    });
  }

  const rootCenter = root._subtreeW / 2;
  assign(root, rootCenter, 0);

  return positions;
}

function svgEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderTree(ast) {
  const container = document.getElementById('tree-container');
  const svg       = document.getElementById('tree-svg');
  const empty     = document.getElementById('tree-empty');

  svg.innerHTML = '';

  if (!ast) {
    if (empty) empty.hidden = false;
    svg.setAttribute('height', 0);
    svg.setAttribute('width', 0);
    return;
  }
  if (empty) empty.hidden = true;

  const positions = computeLayout(ast);

  const BADGE_R  = 10;
  const MARGIN_V = BADGE_R + 6;
  const MARGIN_H = BADGE_R + 8;
  let maxX = 0, maxY = 0;
  for (const { x, y, w, h } of positions.values()) {
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  const treeW = maxX + MARGIN_H * 2;
  const H     = maxY + MARGIN_V * 2;

  svg.setAttribute('width',  treeW);
  svg.setAttribute('height', H);
  svg.removeAttribute('viewBox');
  svg.removeAttribute('preserveAspectRatio');

  const edgeG = svgEl('g', { id: 'tree-edges', transform: `translate(${MARGIN_H}, ${MARGIN_V})` });
  const nodeG = svgEl('g', { id: 'tree-nodes', transform: `translate(${MARGIN_H}, ${MARGIN_V})` });
  svg.appendChild(edgeG);
  svg.appendChild(nodeG);

  function draw(node) {
    const pos = positions.get(node);
    const ch  = children(node);
    const isLetter = node.type === 'letter';

    ch.forEach(child => {
      const cpos = positions.get(child);
      const x1 = pos.x + pos.w / 2;
      const y1 = pos.y + pos.h;
      const x2 = cpos.x + cpos.w / 2;
      const y2 = cpos.y;
      edgeG.appendChild(svgEl('line', {
        x1, y1, x2, y2,
        stroke: 'var(--color-border-strong, #c0bbb3)',
        'stroke-width': '1.5',
      }));
      draw(child);
    });

    const g = svgEl('g', { class: `tree-node tree-node-${isLetter ? 'letter' : 'compound'}` });

    g.appendChild(svgEl('rect', {
      x:      pos.x,
      y:      pos.y,
      width:  pos.w,
      height: pos.h,
      rx: 5, ry: 5,
      fill:   'var(--color-surface)',
      stroke: isLetter ? 'var(--color-teal)' : 'var(--color-primary)',
      'stroke-width': '1.8',
    }));

    g.appendChild(svgEl('text', {
      x: pos.x + pos.w / 2,
      y: pos.y + pos.h / 2,
      'text-anchor':      'middle',
      'dominant-baseline':'central',
      'font-family':      'var(--font-mono)',
      'font-size':        FONT_SZ,
      fill: isLetter ? 'var(--color-teal)' : 'var(--color-primary)',
    }, pos.label));

    nodeG.appendChild(g);
  }

  draw(ast);
}

function renderTreeWithValues(ast, assignment) {
  renderTree(ast);
  if (!ast) return;

  const svg = document.getElementById('tree-svg');
  const positions = computeLayout(ast);

  const nodeValues = new Map();
  function computeValues(node) {
    try {
      const val = evaluate(node, assignment);
      nodeValues.set(node, val);
    } catch (e) { /* skip */ }
    children(node).forEach(computeValues);
  }
  computeValues(ast);

  const BADGE_R2  = 10;
  const MARGIN_H2 = BADGE_R2 + 8;
  const MARGIN_V2 = BADGE_R2 + 6;
  const badgeG = svgEl('g', { id: 'tree-badges', transform: `translate(${MARGIN_H2}, ${MARGIN_V2})` });
  svg.appendChild(badgeG);

  for (const [node, pos] of positions) {
    const val = nodeValues.get(node);
    if (val === undefined) continue;

    const R  = 8;
    const bx = pos.x + pos.w - R * 0.3;
    const by = pos.y + R * 0.3;

    const badge = svgEl('g', {});
    badge.appendChild(svgEl('circle', {
      cx: bx, cy: by, r: R,
      fill:   val ? 'var(--color-true)' : 'var(--color-false)',
      stroke: 'var(--color-surface)',
      'stroke-width': '1.5',
    }));
    badge.appendChild(svgEl('text', {
      x: bx, y: by,
      'text-anchor':      'middle',
      'dominant-baseline':'central',
      'font-family':      'var(--font-sans)',
      'font-size':        '8',
      'font-weight':      '700',
      fill: '#fff',
    }, val ? 'T' : 'F'));
    badgeG.appendChild(badge);
  }
}
