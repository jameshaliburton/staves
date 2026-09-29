// Combining keeps task identities, roles, and connections; collect creates only a parent.
function taskGroupingPair(sourceId, targetId) {
  const source = job(sourceId), target = job(targetId);
  if (!source || !target || source.removed || target.removed || !source.parent || !target.parent || sourceId === targetId) {
    throw new Error('Choose two different tasks to combine.');
  }
  for (const item of [source, target]) {
    const seen = new Set([item.id]);
    let parentId = item.parent;
    while (parentId) {
      if (seen.has(parentId)) throw new Error('These tasks have a circular parent relationship. Resolve it before combining.');
      if (parentId === (item === source ? targetId : sourceId)) throw new Error('A task cannot be combined with its own parent or descendant.');
      seen.add(parentId);
      const parent = job(parentId);
      if (!parent || parent.removed) throw new Error('A task’s parent is no longer available. Reload the board.');
      parentId = parent.parent;
    }
  }
  if (state.board.jobs.some(item => !item.removed && [sourceId, targetId].includes(item.parent))) {
    throw new Error('Choose tasks without nested tasks to combine.');
  }
  const role = trackOf(target);
  if (!role || role.removed) throw new Error('The destination task needs an available role.');
  return {source, target, role};
}

window.combineTasksIntoJob = function(sourceId, targetId) {
  let pair;
  try { pair = taskGroupingPair(sourceId, targetId); } catch (error) { toast(error.message); return; }
  const {source, target, role} = pair;
  const boardId = state.name;
  const basis = JSON.stringify([source.parent, source.track, target.parent, target.track]);
  const veil = $('#veil');
  const previousFocus = document.activeElement;
  veil.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="task-group-title"><div class="sh" id="task-group-title">Combine into a new job</div><div class="sb"><p>Keep both tasks inside a new job on <b>' + esc(role.name) + '</b>.</p><ul><li>' + esc(target.name) + ' · ' + esc(role.name) + '</li><li>' + esc(source.name) + ' · ' + esc(trackOf(source)?.name || 'Unassigned') + '</li></ul><p class="hint">Both tasks keep their roles and existing handoffs. They will move out of their current jobs.</p><label for="task-group-name">New job name</label><input id="task-group-name" placeholder="Describe the shared result" autocomplete="off"><p id="task-group-error" role="alert"></p></div><div class="sf"><button class="bt q" id="task-group-cancel">Cancel</button><button class="bt acc" id="task-group-save">Create job with 2 tasks</button></div></div>';
  veil.classList.add('show');
  const input = $('#task-group-name'), save = $('#task-group-save'), cancel = $('#task-group-cancel');
  const dismiss = () => { closeSheet(); if (previousFocus?.isConnected) previousFocus.focus(); };
  cancel.onclick = dismiss;
  save.onclick = async () => {
    if (save.disabled) return;
    const name = input.value.trim();
    if (!name) { $('#task-group-error').textContent = 'Name the new job.'; input.focus(); return; }
    try {
      if (state.name !== boardId) throw new Error('The board changed. Reopen this action on the current board.');
      const current = taskGroupingPair(sourceId, targetId);
      if (JSON.stringify([current.source.parent, current.source.track, current.target.parent, current.target.track]) !== basis) {
        throw new Error('These tasks moved or changed roles. Reopen this action to review their current placement.');
      }
      save.disabled = true; cancel.disabled = true; veil.dataset.saving = 'true';
      const id = 'job-' + crypto.randomUUID();
      await checkedOp([{t: 'collect', id, name, track: current.role.id, into: [targetId, sourceId]}]);
      if (state.name === boardId && save.isConnected) {
        delete veil.dataset.saving;
        dismiss(); state.multi.clear(); select(id, 'job');
        toast('New job created with both tasks · Undo is available');
      }
    } catch (error) {
      if (save.isConnected) $('#task-group-error').textContent = error.message;
    } finally {
      delete veil.dataset.saving; save.disabled = false; cancel.disabled = false;
    }
  };
  veil.querySelector('.sheet').onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!save.disabled) dismiss(); }
    if (event.key === 'Enter' && event.target === input) { event.preventDefault(); save.click(); }
    if (event.key !== 'Tab') return;
    const controls = [input, cancel, save].filter(control => !control.disabled);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  input.focus();
};
