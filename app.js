/**
 * Propositional Logic Formula Checker — App Controller
 *
 * Features:
 *  - Live parse-on-input with ASCII normalisation
 *  - Parse tree SVG (plain on valid formula, with T/F badges after Evaluate)
 *  - Assignment panel with radio T/F buttons
 *  - URL hash state (#v1:<base64-json>) — updated on every change
 *  - Card mode: ?card=formula | ?card=formula,assign
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentAst     = null;
let currentLetters = [];

// ── Card mode ─────────────────────────────────────────────────────────────────
const CARD_PARAMS = new Set(['formula', 'assign', 'formula,assign']);
const urlParams   = new URLSearchParams(window.location.search);
const cardMode    = urlParams.get('card');
const isCardMode  = cardMode !== null && CARD_PARAMS.has(cardMode);
const showFormula = !isCardMode || cardMode.includes('formula');
const showAssign  = !isCardMode || cardMode.includes('assign');

if (isCardMode) {
  document.documentElement.setAttribute('data-card', cardMode);
}

// ── Theme toggle ──────────────────────────────────────────────────────────────
(function () {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  const btn = document.querySelector('[data-theme-toggle]');
  if (btn) btn.addEventListener('click', () => {
    root.setAttribute('data-theme',
      root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
})();

// ── Help panel ────────────────────────────────────────────────────────────────
function toggleHelp(e) {
  if (e) e.preventDefault();
  const panel = document.getElementById('help-panel');
  if (panel) panel.hidden = !panel.hidden;
}

// ── Symbol insertion ──────────────────────────────────────────────────────────
const formulaInput = document.getElementById('formula-input');

function insertSym(sym) {
  if (!formulaInput) return;
  const start = formulaInput.selectionStart;
  const end   = formulaInput.selectionEnd;
  formulaInput.value = formulaInput.value.slice(0, start) + sym + formulaInput.value.slice(end);
  formulaInput.selectionStart = formulaInput.selectionEnd = start + sym.length;
  formulaInput.focus();
  formulaInput.dispatchEvent(new Event('input'));
}

function setExample(formula) {
  if (!formulaInput) return;
  formulaInput.value = formula;
  formulaInput.focus();
  formulaInput.dispatchEvent(new Event('input'));
}

// ── URL hash — encode / decode state ─────────────────────────────────────────
function encodeHash(formula, assignment) {
  const obj = { f: formula };
  if (assignment && Object.keys(assignment).length > 0) obj.a = assignment;
  try {
    return '#v1:' + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  } catch (e) { return ''; }
}

function decodeHash(hash) {
  try {
    if (!hash || !hash.startsWith('#v1:')) return null;
    const json = decodeURIComponent(escape(atob(hash.slice(4))));
    return JSON.parse(json);
  } catch (e) { return null; }
}

function pushHash(formula, assignment) {
  const h = encodeHash(formula, assignment);
  if (h) history.replaceState(null, '', h);
}

// ── Live parse on input ───────────────────────────────────────────────────────
if (formulaInput) {
  formulaInput.addEventListener('input', () => onFormulaChange(true));
}

function onFormulaChange(updateHash = false) {
  const raw      = formulaInput ? formulaInput.value.trim() : '';
  const statusEl = document.getElementById('parse-status');
  const evalSec  = document.getElementById('eval-section');

  if (!raw) {
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'parse-status'; }
    if (formulaInput) formulaInput.className = 'formula-input-field';
    currentAst     = null;
    currentLetters = [];
    renderTree(null);
    if (evalSec) evalSec.hidden = true;
    if (updateHash) history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }

  // Try official formula
  try {
    currentAst     = parse(raw);
    currentLetters = collectLetters(currentAst);
    const pretty   = prettyPrint(currentAst, true);
    if (statusEl) { statusEl.textContent = '✓ ' + pretty; statusEl.className = 'parse-status ok'; }
    if (formulaInput) formulaInput.className = 'formula-input-field valid';
    renderTree(currentAst);
    buildEvalUI(currentLetters, null);
    if (evalSec && showAssign) evalSec.hidden = false;
    if (updateHash) pushHash(raw, getCurrentAssignment());
    return;
  } catch (e1) { /* fall through */ }

  // Try unofficial (omitted outer parens)
  try {
    const ast      = parse('(' + raw + ')');
    currentAst     = ast;
    currentLetters = collectLetters(ast);
    const official = prettyPrint(ast, false);
    if (statusEl) {
      statusEl.innerHTML = '✓ Unofficial formula — abbreviates <span class="abbrev-target">' + escHtml(official) + '</span>';
      statusEl.className = 'parse-status ok';
    }
    if (formulaInput) formulaInput.className = 'formula-input-field valid';
    renderTree(ast);
    buildEvalUI(currentLetters, null);
    if (evalSec && showAssign) evalSec.hidden = false;
    if (updateHash) pushHash(raw, getCurrentAssignment());
    return;
  } catch (e2) { /* fall through */ }

  // Neither
  currentAst     = null;
  currentLetters = [];
  if (statusEl) { statusEl.textContent = '✗ Not a formula or an abbreviation.'; statusEl.className = 'parse-status err'; }
  if (formulaInput) formulaInput.className = 'formula-input-field invalid';
  renderTree(null);
  if (evalSec) evalSec.hidden = true;
  if (updateHash) history.replaceState(null, '', window.location.pathname + window.location.search);
}

// ── Assignment UI ─────────────────────────────────────────────────────────────
/**
 * Build assignment radio rows.
 * preset: { 'p': true, 'q': false, ... } or null
 */
function buildEvalUI(letters, preset) {
  const grid = document.getElementById('assignment-grid');
  if (!grid) return;

  // Preserve existing selections if no preset
  const prev = preset || getCurrentAssignment();
  grid.innerHTML = '';

  letters.forEach(letter => {
    const row = document.createElement('div');
    row.className = 'assignment-row';

    const lbl = document.createElement('span');
    lbl.className   = 'assignment-label';
    lbl.textContent = letter + ':';
    row.appendChild(lbl);

    const radGroup = document.createElement('div');
    radGroup.className = 'radio-group';

    [['T', true], ['F', false]].forEach(([label, val]) => {
      const radioId = `assign-${letter}-${label}`;

      const radio = document.createElement('input');
      radio.type    = 'radio';
      radio.name    = `assign-${letter}`;
      radio.id      = radioId;
      radio.value   = val ? 'true' : 'false';
      radio.dataset.letter = letter;
      // Default: T (true) unless preset says otherwise
      const presetVal = (prev && prev[letter] !== undefined) ? prev[letter] : true;
      if (val === presetVal) radio.checked = true;
      radio.addEventListener('change', () => {
        if (currentAst) {
          const asgn = getCurrentAssignment();
          renderTreeWithValues(currentAst, asgn);
          pushHash(formulaInput ? formulaInput.value.trim() : '', asgn);
        }
      });

      const lblEl = document.createElement('label');
      lblEl.htmlFor   = radioId;
      lblEl.className = 'radio-label';
      lblEl.textContent = label;

      radGroup.appendChild(radio);
      radGroup.appendChild(lblEl);
    });

    row.appendChild(radGroup);
    grid.appendChild(row);
  });
}

function getCurrentAssignment() {
  const asgn = {};
  document.querySelectorAll('input[type="radio"][data-letter]:checked').forEach(r => {
    asgn[r.dataset.letter] = r.value === 'true';
  });
  return asgn;
}

// ── Run evaluation ────────────────────────────────────────────────────────────
function runEvaluation() {
  if (!currentAst) return;
  const asgn = getCurrentAssignment();
  renderTreeWithValues(currentAst, asgn);
  if (formulaInput) pushHash(formulaInput.value.trim(), asgn);
}

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runEvaluation();
});

// ── Load from hash on startup ─────────────────────────────────────────────────
function loadFromHash() {
  const state = decodeHash(window.location.hash);
  if (!state || !state.f) return false;

  if (formulaInput) {
    formulaInput.value = state.f;
  }
  onFormulaChange(false);  // parse + render tree, don't rewrite hash

  // Apply saved assignment (if any) after the UI is built
  if (state.a && currentLetters.length > 0) {
    buildEvalUI(currentLetters, state.a);
  }

  // Auto-evaluate if assignment is present (to show T/F badges)
  if (state.a && currentAst) {
    const asgn = state.a;
    // Convert string values to bool if needed (JSON always stores bool, but be safe)
    const normAsgn = {};
    for (const [k, v] of Object.entries(asgn)) {
      normAsgn[k] = (v === true || v === 'true');
    }
    renderTreeWithValues(currentAst, normAsgn);
  }

  return true;
}

// ── Card mode: hide sections based on ?card= param ───────────────────────────
function applyCardMode() {
  if (!isCardMode) return;

  // In card mode hide the header and help panel
  const header = document.querySelector('.app-header');
  if (header) header.hidden = true;
  const helpPanel = document.getElementById('help-panel');
  if (helpPanel) helpPanel.hidden = true;

  // formula card: show formula input + parse tree
  // assign card:  show assignment + tree (formula input hidden)
  // formula,assign: show everything (default full card)
  if (cardMode === 'formula') {
    const evalSec = document.getElementById('eval-section');
    if (evalSec) evalSec.hidden = true;
  }
  if (cardMode === 'assign') {
    const fCard = document.getElementById('formula-card');
    if (fCard) fCard.hidden = true;
  }
}


// ── Copy link ──────────────────────────────────────────────────────────────────
const copyLinkBtn = document.getElementById('copy-link-btn');

function copyLink() {
  // Build a URL with the current hash (already maintained by pushHash)
  const url = location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => flashCopy('Copied!'),
      () => { history.replaceState(null, '', url); flashCopy('Link ready'); }
    );
  } else {
    history.replaceState(null, '', url);
    flashCopy('Link ready');
  }
}

function flashCopy(msg) {
  if (!copyLinkBtn) return;
  const textEl = copyLinkBtn.querySelector('.copy-link-text');
  const original = textEl ? textEl.textContent : copyLinkBtn.textContent;
  if (textEl) textEl.textContent = msg; else copyLinkBtn.textContent = msg;
  copyLinkBtn.classList.add('shared');
  setTimeout(() => {
    if (textEl) textEl.textContent = original; else copyLinkBtn.textContent = original;
    copyLinkBtn.classList.remove('shared');
  }, 1800);
}

if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyLink);

// ── Tree tab switching ───────────────────────────────────────────────────────
let _activeTab = 'view';

function switchTreeTab(tab) {
  _activeTab = tab;
  const panelView  = document.getElementById('panel-view');
  const panelBuild = document.getElementById('panel-build');
  const tabView    = document.getElementById('tab-view');
  const tabBuild   = document.getElementById('tab-build');
  const solRow     = document.getElementById('practice-solution-row');

  if (tab === 'view') {
    panelView.hidden  = false;
    panelBuild.hidden = true;
    tabView.classList.add('tree-tab-active');
    tabView.setAttribute('aria-selected', 'true');
    tabBuild.classList.remove('tree-tab-active');
    tabBuild.setAttribute('aria-selected', 'false');
  } else {
    panelView.hidden  = true;
    panelBuild.hidden = false;
    tabView.classList.remove('tree-tab-active');
    tabView.setAttribute('aria-selected', 'false');
    tabBuild.classList.add('tree-tab-active');
    tabBuild.setAttribute('aria-selected', 'true');
    // Start or refresh practice session
    if (currentAst) {
      startPractice(currentAst);
      // solRow is shown by ptSetDone(true) after tree completion
    } else {
      const practiceStatus = document.getElementById('practice-status');
      if (practiceStatus) practiceStatus.textContent = 'Enter a valid formula above, then switch to Build mode.';
    }
  }
}

function togglePracticeSolution() {
  const panel = document.getElementById('practice-solution-panel');
  const btn   = document.getElementById('practice-solution-btn');
  const solSvg = document.getElementById('solution-svg');
  if (!panel) return;
  const nowHidden = panel.hidden;
  panel.hidden = !nowHidden;
  if (btn) btn.textContent = nowHidden ? 'Hide solution' : 'Show solution';
  // Render the solution tree into the solution SVG when first revealed
  if (nowHidden && currentAst && solSvg) {
    // Temporarily redirect renderTree output to solution-svg
    const origId = document.getElementById('tree-svg').id;
    const tmpSvg = document.getElementById('tree-svg');
    tmpSvg.id = '__tmp_hidden';
    solSvg.id = 'tree-svg';
    renderTree(currentAst);
    solSvg.id = 'solution-svg';
    tmpSvg.id = origId;
  }
}

// ── Hook practiceAnswer and startPractice into onFormulaChange ────────────────
const _origOnFormulaChange = onFormulaChange;
// Patch: when formula changes while on build tab, restart practice
const _origRenderTree = renderTree;

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  applyCardMode();
  const loaded = loadFromHash();
  if (!loaded) {
    renderTree(null);
  }
})();

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
