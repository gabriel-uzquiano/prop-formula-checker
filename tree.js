// tree.js — SVG parse tree renderer

const TREE_COLORS = {
  LETTER: { stroke: '#4a9ead', fill: '#e8f6f8' },
  NEG:    { stroke: '#c0606a', fill: '#fdf0f1' },
  AND:    { stroke: '#c0606a', fill: '#fdf0f1' },
  OR:     { stroke: '#c0606a', fill: '#fdf0f1' },
  IMP:    { stroke: '#c0606a', fill: '#fdf0f1' },
};

const NODE_W = 110, NODE_H = 34, NODE_RX = 6;
const V_GAP = 54, H_GAP = 16;

function measureTree(tree) {
  if (!tree) return { w: NODE_W, h: NODE_H };
  if (tree.type === 'LETTER') return { w: NODE_W, h: NODE_H, children: [] };

  const children = tree.type === 'NEG'
    ? [tree.sub]
    : [tree.left, tree.right];

  const childMeasures = children.map(measureTree);
  const totalChildW = childMeasures.reduce((s, m) => s + m.w, 0) + H_GAP * (children.length - 1);
  const w = Math.max(NODE_W, totalChildW);
  const childH = Math.max(...childMeasures.map(m => m.h));
  return { w, h: NODE_H + V_GAP + childH, children: childMeasures };
}

function layoutTree(tree, measures, x, y) {
  if (!tree) return [];
  const nodes = [];
  const cx = x + measures.w / 2;
  const cy = y + NODE_H / 2;
  const children = tree.type === 'NEG' ? [tree.sub] : tree.type === 'LETTER' ? [] : [tree.left, tree.right];

  // Layout children
  let childX = x;
  const childNodes = [];
  children.forEach((child, i) => {
    const cm = measures.children[i];
    const sub = layoutTree(child, cm, childX, y + NODE_H + V_GAP);
    childNodes.push(...sub);
    childX += cm.w + H_GAP;
  });

  // Compute child centres for edge drawing
  let cxChild = x;
  const childCentres = children.map((_, i) => {
    const cm = measures.children[i];
    const centre = cxChild + cm.w / 2;
    cxChild += cm.w + H_GAP;
    return centre;
  });

  nodes.push({ tree, cx, cy, childCentres, childY: y + NODE_H + V_GAP + NODE_H / 2 });
  nodes.push(...childNodes);
  return nodes;
}

function renderTree(svg, tree, assignment) {
  svg.innerHTML = '';
  if (!tree) return;

  const measures = measureTree(tree);
  const PAD = 16;
  const totalW = measures.w + PAD * 2;
  const totalH = measures.h + PAD * 2;

  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svg.setAttribute('width', totalW);
  svg.setAttribute('height', totalH);

  const nodes = layoutTree(tree, measures, PAD, PAD);

  // Draw edges first
  nodes.forEach(n => {
    n.childCentres.forEach(childCx => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', n.cx);
      line.setAttribute('y1', n.cy + NODE_H / 2);
      line.setAttribute('x2', childCx);
      line.setAttribute('y2', n.childY);
      line.setAttribute('stroke', '#ccc');
      line.setAttribute('stroke-width', '1.5');
      svg.appendChild(line);
    });
  });

  // Draw nodes
  nodes.forEach(n => {
    const col = TREE_COLORS[n.tree.type] || TREE_COLORS.LETTER;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', n.cx - NODE_W / 2);
    rect.setAttribute('y', n.cy - NODE_H / 2);
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', NODE_RX);
    rect.setAttribute('fill', col.fill);
    rect.setAttribute('stroke', col.stroke);
    rect.setAttribute('stroke-width', '1.5');

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', n.cx);
    label.setAttribute('y', n.cy + 1);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-family', 'monospace');
    label.setAttribute('font-size', '13');
    label.setAttribute('fill', '#333');
    label.textContent = n.tree.str;

    g.appendChild(rect);
    g.appendChild(label);

    // Truth value badge (top-left of node)
    if (assignment !== null && assignment !== undefined) {
      const val = evaluate(n.tree, assignment);
      if (val !== null) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('x', n.cx - NODE_W / 2 + 5);
        badge.setAttribute('y', n.cy - NODE_H / 2 + 11);
        badge.setAttribute('font-family', 'monospace');
        badge.setAttribute('font-size', '10');
        badge.setAttribute('font-weight', 'bold');
        badge.setAttribute('fill', val ? '#2a9d5c' : '#c0606a');
        badge.textContent = val ? 'T' : 'F';
        g.appendChild(badge);
      }
    }

    svg.appendChild(g);
  });

  // Auto-scale to container
  const container = svg.parentElement;
  if (container) {
    const cw = container.clientWidth || 400;
    if (totalW > cw) {
      svg.setAttribute('width', cw);
      svg.setAttribute('height', Math.round(totalH * cw / totalW));
    }
  }
}
