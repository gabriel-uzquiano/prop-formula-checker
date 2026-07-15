// app.js — Propositional Formula Checker

// ── State ─────────────────────────────────────────────────────────────────────
let currentTree = null;
let currentLetters = [];
let currentAssignment = {};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const input       = document.getElementById('formula-input');
const statusEl    = document.getElementById('formula-status');
const treeCard    = document.getElementById('tree-card');
const treeSvg     = document.getElementById('tree-svg');
const treeWrap    = document.getElementById('tree-wrap');
const assignCard  = document.getElementById('assign-card');
const assignSlots = document.getElementById('assign-slots');
const evalBtn     = document.getElementById('eval-btn');
const helpBtn     = document.getElementById('help-btn');
const helpPanel   = document.getElementById('help-panel');
const helpClose   = document.getElementById('help-close');
const themeBtn    = document.getElementById('theme-btn');

// ── Helpers ───────────────────────────────────────────────────────────────────
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

// ── Theme ─────────────────────────────────────────────────────────────────────
const savedTheme = localStorage.getItem('pfc-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
themeBtn.addEventListener('click', () => {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('pfc-theme', t);
});

// ── Help panel ────────────────────────────────────────────────────────────────
helpBtn.addEventListener('click', () => {
  helpPanel.classList.toggle('hidden');
});
helpClose.addEventListener('click', () => hide(helpPanel));

// ── Symbol buttons ────────────────────────────────────────────────────────────
document.querySelectorAll('.sym-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sym = btn.dataset.sym;
    const start = input.selectionStart, end = input.selectionEnd;
    const val = input.value;
    input.value = val.slice(0, start) + sym + val.slice(end);
    input.selectionStart = input.selectionEnd = start + sym.length;
    input.focus();
    onInput();
  });
});

// ── Example chips ─────────────────────────────────────────────────────────────
document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.formula;
    onInput();
    input.focus();
  });
});

// ── Assignment slots ──────────────────────────────────────────────────────────
function buildAssignSlots(letters) {
  assignSlots.innerHTML = '';
  letters.forEach(letter => {
    const wrap = document.createElement('div');
    wrap.className = 'assign-slot';
    wrap.innerHTML = `
      <span class="assign-letter">${letter}</span>
      <label class="assign-radio">
        <input type="radio" name="assign-${letter}" value="T" ${currentAssignment[letter] === true ? 'checked' : ''}> T
      </label>
      <label class="assign-radio">
        <input type="radio" name="assign-${letter}" value="F" ${currentAssignment[letter] === false ? 'checked' : ''}> F
      </label>`;
    assignSlots.appendChild(wrap);
    wrap.querySelectorAll('input[type=radio]').forEach(r => {
      r.addEventListener('change', () => {
        currentAssignment[letter] = r.value === 'T';
      });
    });
  });
}

// ── Evaluate ──────────────────────────────────────────────────────────────────
evalBtn.addEventListener('click', () => {
  // Check all letters have assignments
  const missing = currentLetters.filter(l => currentAssignment[l] === undefined);
  if (missing.length) {
    missing.forEach(l => {
      assignSlots.querySelectorAll(`[name="assign-${l}"]`).forEach(r => {
        r.closest('.assign-slot').classList.add('missing');
      });
    });
    return;
  }
  assignSlots.querySelectorAll('.assign-slot').forEach(s => s.classList.remove('missing'));
  renderTree(treeSvg, currentTree, currentAssignment);
  saveHash();
});

// ── Main parse handler ────────────────────────────────────────────────────────
function onInput() {
  const raw = input.value;
  if (!raw.trim()) {
    input.classList.remove('valid', 'invalid');
    statusEl.textContent = '';
    statusEl.className = 'formula-status';
    hide(treeCard);
    hide(assignCard);
    currentTree = null;
    currentLetters = [];
    saveHash();
    return;
  }

  const result = parseFormula(raw);
  if (!result.ok) {
    input.classList.remove('valid');
    input.classList.add('invalid');
    statusEl.textContent = '✗ Not a formula or an abbreviation.';
    statusEl.className = 'formula-status error';
    hide(treeCard);
    hide(assignCard);
    currentTree = null;
    currentLetters = [];
    saveHash();
    return;
  }

  input.classList.remove('invalid');
  input.classList.add('valid');

  if (result.official) {
    statusEl.textContent = '✓ ' + result.officialStr;
    statusEl.className = 'formula-status ok';
  } else {
    statusEl.textContent = '✓ Unofficial formula — abbreviates ' + result.officialStr;
    statusEl.className = 'formula-status ok unofficial';
  }

  currentTree = result.tree;
  currentLetters = [...getLetters(currentTree)].sort();

  // Reset assignment for any new letters
  currentLetters.forEach(l => {
    if (currentAssignment[l] === undefined) currentAssignment[l] = undefined;
  });
  // Remove stale letters
  Object.keys(currentAssignment).forEach(k => {
    if (!currentLetters.includes(k)) delete currentAssignment[k];
  });

  // Render tree (without assignment)
  show(treeCard);
  renderTree(treeSvg, currentTree, null);

  // Show assignment card
  buildAssignSlots(currentLetters);
  show(assignCard);

  saveHash();
}

input.addEventListener('input', onInput);

// ── URL hash state ────────────────────────────────────────────────────────────
function saveHash() {
  const state = {
    f: input.value,
    a: currentAssignment,
  };
  const json = JSON.stringify(state);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  history.replaceState(null, '', '#v1:' + b64);
}

function loadHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#v1:')) return;
  try {
    const json = decodeURIComponent(escape(atob(hash.slice(4))));
    const state = JSON.parse(json);
    if (state.f) {
      input.value = state.f;
      if (state.a) currentAssignment = state.a;
      onInput();
      // If assignment present, re-render with values
      if (state.a && currentTree) {
        buildAssignSlots(currentLetters);
        renderTree(treeSvg, currentTree, currentAssignment);
      }
    }
  } catch(e) {}
}

// ── Card mode ─────────────────────────────────────────────────────────────────
(function initCardMode() {
  const params = new URLSearchParams(location.search);
  const card = params.get('card');
  if (!card) return;

  document.body.classList.add('card-mode');
  const cards = card.split(',').map(s => s.trim());
  const appMain = document.querySelector('.app-main');

  // Hide header in card mode
  const header = document.querySelector('.app-header');
  if (header) header.style.display = 'none';

  // Show only requested cards, hide others
  const allCardIds = ['formula-card', 'tree-card', 'assign-card'];
  const cardMap = { formula: 'formula-card', tree: 'tree-card', assign: 'assign-card' };

  allCardIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  cards.forEach(c => {
    const id = cardMap[c];
    if (id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    }
  });

  // In card mode always show tree/assign if formula valid — no need for manual show/hide
})();

// ── Init ──────────────────────────────────────────────────────────────────────
loadHash();
