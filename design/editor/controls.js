// One visual form was doing three unrelated jobs — showing a fact, offering an action, and marking a
// gap — so nothing told you which pills you could press. Worse, the ones you could press were spans:
// no role, no tab stop, nothing announced. This gives them the behaviour their appearance promises.
(() => {
  // A control announced as a button must answer to Enter and Space, or it is a lie to a screen reader.
  addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.getAttribute('role') !== 'button') return;
    if (target.matches('button, a, input, select, textarea')) return;   // already native
    event.preventDefault();                                             // Space must not scroll the board
    target.click();
  }, true);

  // One choice means one tab stop, and the arrows move within it. Tabbing through every option of a
  // set is what made these feel like four unrelated buttons rather than one decision.
  const options = group => [...group.querySelectorAll('[role="radio"]')];
  const roving = () => {
    for (const group of document.querySelectorAll('[role="radiogroup"]')) {
      const opts = options(group);
      const chosen = opts.findIndex(o => o.getAttribute('aria-checked') === 'true');
      opts.forEach((o, i) => { o.tabIndex = i === (chosen < 0 ? 0 : chosen) ? 0 : -1; });
    }
  };
  addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof Element) || target.getAttribute('role') !== 'radio') return;
    const group = target.closest('[role="radiogroup"]'); if (!group) return;
    const opts = options(group); const at = opts.indexOf(target);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : event.key === 'Home' ? -Infinity : event.key === 'End' ? Infinity : 0;
    if (!step) return;
    event.preventDefault();
    const next = step === -Infinity ? 0 : step === Infinity ? opts.length - 1
      : (at + step + opts.length) % opts.length;
    opts[next]?.focus(); opts[next]?.click();
  }, true);

  // A pill that only reports a number should not look pressable. The markup cannot always say which
  // is which, but the presence of a handler can.
  const classify = () => {
    for (const chip of document.querySelectorAll('.chip')) {
      const acts = chip.tagName === 'BUTTON' || chip.hasAttribute('onclick') || chip.getAttribute('role') === 'button';
      chip.classList.toggle('chip-acts', acts);
      chip.classList.toggle('chip-fact', !acts);
    }
    for (const marker of document.querySelectorAll('.clip .by')) {
      const name = marker.closest('.clip')?.querySelector('.t')?.textContent || 'this job';
      const label = 'Review unconfirmed details for ' + name;
      marker.setAttribute('role', 'button');
      marker.setAttribute('tabindex', '0');
      marker.setAttribute('aria-label', label);
      marker.setAttribute('aria-haspopup', 'dialog');
      marker.setAttribute('data-tip', label);
      if (marker.textContent !== 'Review') marker.textContent = 'Review';
    }
    const review = document.querySelector('#pop .settle');
    if (review) {
      const heading = review.querySelector(':scope > b');
      const explanation = review.querySelector(':scope > span');
      if (heading?.textContent === 'I made this up') {
        heading.textContent = 'Review this description';
        explanation.textContent = 'These details have not been confirmed by a person. Confirm only the details you have checked, or discuss a correction. This does not mark the work implemented or complete.';
        review.setAttribute('role', 'dialog');
        review.setAttribute('aria-label', 'Review unconfirmed description details');
        const all = review.querySelector('[data-all] span');
        if (all) all.textContent = 'Confirm all listed details';
      }
    }
    roving();
  };
  // Coalesce, but never wait on a frame: a backgrounded tab paints no frames, and a chip that has
  // not been classified is a chip that lies about whether you can press it.
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; classify(); }, 0); };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', schedule); else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
