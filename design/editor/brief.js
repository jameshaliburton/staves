/* A living brief stays beside the canvas; only Save writes to the board. */
const boardBriefFields = [
  ['purpose', 'Purpose', 'Why does this work exist?'],
  ['improvement', 'Improvement sought', 'What should work better than it does today?'],
  ['success', 'Success criteria', 'What would show that the improvement worked?'],
  ['mustNot', 'Constraints', 'What must stay true or must not happen?'],
  ['outside', 'People affected', 'Who relies on the result or experiences this work?'],
];
const boardBriefDrafts = new Map();
let boardBriefElement = null;

/* A board an agent drew records its purpose as the board's goal and never writes context.purpose —
 * the brief panel is the only thing that writes that key. Reading only the key made every described
 * board say "Purpose not yet recorded" while its purpose sat in the header above. The goal is the
 * recorded purpose; read it as one, and Save keeps writing both. */
function briefContext(board) {
  const context = board?.context || {};
  return context.purpose?.trim() ? context : { ...context, purpose: board?.goal || '' };
}
function briefContextValues(context = {}) {
  return Object.fromEntries(boardBriefFields.map(([key]) => [key, context?.[key] || '']));
}
function briefUnknowns(context = {}) {
  return boardBriefFields.filter(([key]) => !context?.[key]?.trim()).map(([, label]) => label);
}
function discussBoardBrief() {
  talkWithStaves('board', 'Help me develop this board’s brief: purpose, improvement sought, success criteria, constraints, and people affected. Use what is already recorded and ask one focused question about the most consequential unknown. Do not invent answers.');
}
function paintBoardBrief() {
  const host = $('#tl');
  if (!host || !state.board) return;
  const boardId = state.name || state.board.id;
  let draft = boardBriefDrafts.get(boardId);
  if (!draft) {
    draft = { values: briefContextValues(briefContext(state.board)), dirty: false, open: false, saving: false };
    boardBriefDrafts.set(boardId, draft);
  }
  if (!draft.dirty && !draft.saving) draft.values = briefContextValues(briefContext(state.board));
  if (boardBriefElement?.dataset.board === boardId && boardBriefElement.isConnected) {
    if (!draft.dirty && !draft.saving) {
      for (const [key] of boardBriefFields) boardBriefElement.querySelector('[name="' + key + '"]').value = draft.values[key];
    }
    updateBoardBriefSummary(boardBriefElement, briefContext(state.board));
    return;
  }
  boardBriefElement?.remove();
  const panel = document.createElement('details');
  panel.id = 'board-brief';
  panel.dataset.board = boardId;
  panel.open = draft.open;
  panel.innerHTML = '<summary><strong>Board brief</strong><span class="brief-summary"></span><span class="brief-expand" aria-hidden="true">Edit brief</span></summary>'
    + '<form class="brief-form"><p class="brief-help">Keep the intent visible as the workflow changes. Leave unanswered details blank.</p><div class="brief-fields">'
    + boardBriefFields.map(([key, label, hint]) => '<label for="brief-' + key + '">' + label + '<textarea id="brief-' + key + '" name="' + key + '" rows="2" placeholder="' + hint + '"></textarea></label>').join('')
    + '</div><div class="brief-actions"><button type="submit" class="editor-button primary">Save brief</button><button type="button" class="editor-button brief-discuss">Discuss with Staves</button><span class="brief-status" role="status" aria-live="polite"></span><span class="brief-error" role="alert"></span></div></form>';
  host.insertBefore(panel, host.querySelector('.ph')?.nextSibling || host.firstChild);
  boardBriefElement = panel;
  updateBoardBriefSummary(panel, briefContext(state.board));
  panel.ontoggle = () => { draft.open = panel.open; };
  for (const [key] of boardBriefFields) {
    const input = panel.querySelector('[name="' + key + '"]');
    input.value = draft.values[key];
    input.oninput = () => {
      draft.values[key] = input.value;
      draft.dirty = true;
      panel.querySelector('.brief-status').textContent = 'Unsaved changes';
      panel.querySelector('.brief-error').textContent = '';
    };
  }
  panel.querySelector('.brief-discuss').onclick = discussBoardBrief;
  panel.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    if (draft.saving || state.name !== boardId) return;
    draft.saving = true;
    const values = { ...draft.values };
    const controls = [...panel.querySelectorAll('textarea, button')];
    controls.forEach(control => { control.disabled = true; });
    panel.querySelector('.brief-error').textContent = '';
    panel.querySelector('.brief-status').textContent = 'Saving…';
    try {
      await checkedOp([{ t: 'setContext', context: values }, { t: 'board', id: state.board.id, title: state.board.title, goal: values.purpose }]);
      draft.dirty = false;
      panel.querySelector('.brief-status').textContent = 'Brief saved';
      updateBoardBriefSummary(panel, values);
    } catch (error) {
      panel.querySelector('.brief-status').textContent = 'Changes not saved';
      panel.querySelector('.brief-error').textContent = error.message || 'Could not save the brief. Try again.';
    } finally {
      draft.saving = false;
      controls.forEach(control => { control.disabled = false; });
    }
  };
}
function updateBoardBriefSummary(panel, context = {}) {
  const unknowns = briefUnknowns(context);
  panel.querySelector('.brief-summary').textContent = context?.purpose?.trim() || 'Purpose not yet recorded';
  panel.querySelector('summary').title = unknowns.length ? 'Not yet recorded: ' + unknowns.join(', ') : 'Purpose, improvement, success criteria, constraints and people recorded';
}
const renderBeforeBoardBrief = render;
render = function() { renderBeforeBoardBrief(); paintBoardBrief(); };
if (state.board) paintBoardBrief();
