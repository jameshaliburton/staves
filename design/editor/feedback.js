// Say what you noticed while you are still looking at it. The picture is the point — describing a
// board in words is exactly the work the person came here to avoid — but the words are what must
// survive: every failure below still sends them.
(() => {
  const KINDS = [
    ['problem', 'Something is wrong'],
    ['confusion', 'I could not tell'],
    ['idea', 'It could do this'],
    ['note', 'Just a note'],
  ];
  let hosted = null, open = false, shot = null;

  const el = (tag, props = {}, ...kids) => Object.assign(document.createElement(tag), props, kids.length ? { append: undefined } : {});
  const make = (tag, props, kids = []) => { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };

  async function isHosted() {
    if (hosted !== null) return hosted;
    try {
      const response = await fetch('/auth/me');
      const identity = response.ok ? await response.json() : null;
      hosted = identity?.hosted === true && typeof identity.id === 'string' && identity.id.length > 0;
    } catch { hosted = false; }
    return hosted;
  }

  async function feedbackReceipt(response) {
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true) throw new Error(data?.error || 'Your note was not confirmed as sent. Please try again.');
    return data;
  }

  /** The board is SVG and web fonts; both need inlining or the picture comes back blank. */
  async function capture(button) {
    button.disabled = true; const was = button.textContent; button.textContent = 'Capturing…';
    try {
      const { toPng } = await import('./vendor/html-to-image.js');
      const png = await toPng(document.body, {
        pixelRatio: 1,
        cacheBust: true,
        filter: node => !(node instanceof Element && node.closest?.('#feedback-panel')),
      });
      if (typeof png !== 'string' || !png.startsWith('data:image/')) throw new Error('empty');
      shot = png;
      return true;
    } catch { shot = null; return false; }
    finally { button.disabled = false; button.textContent = was; }
  }

  function panel() {
    const existing = document.querySelector('#feedback-panel');
    if (existing) { existing.remove(); open = false; return; }
    open = true; shot = null;

    const status = make('p', { className: 'feedback-status', role: 'status' });
    const text = make('textarea', { id: 'feedback-body', maxLength: 4000, rows: 5, placeholder: 'What happened, and what did you expect instead?' });
    const kind = make('select', { id: 'feedback-kind' }, KINDS.map(([value, label]) => make('option', { value, textContent: label })));

    const preview = make('div', { className: 'feedback-shot', hidden: true });
    const shoot = make('button', { type: 'button', className: 'button', textContent: 'Add a screenshot' });
    shoot.onclick = async () => {
      const box = document.querySelector('#feedback-panel');
      box.hidden = true;                                   // do not photograph the panel over the thing
      const ok = await capture(shoot);
      box.hidden = false;
      preview.replaceChildren();
      if (ok) {
        preview.append(make('img', { src: shot, alt: 'Screenshot to send with this note' }));
        const drop = make('button', { type: 'button', className: 'link', textContent: 'Remove' });
        drop.onclick = () => { shot = null; preview.hidden = true; preview.replaceChildren(); shoot.hidden = false; };
        preview.append(drop);
        preview.hidden = false; shoot.hidden = true; status.textContent = '';
      } else {
        status.textContent = 'The screenshot could not be taken. Your note will still send.';
      }
    };

    const send = make('button', { type: 'button', className: 'button primary', textContent: 'Send to the team' });
    send.onclick = async () => {
      const said = text.value.trim();
      if (!said) { status.textContent = 'Say what you noticed first.'; text.focus(); return; }
      send.disabled = true; status.textContent = 'Sending…';
      try {
        const response = await fetch('./workspace-api/feedback', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: kind.value, body: said, screenshot: shot,
            board: new URLSearchParams(location.search).get('board'),
            route: location.pathname + location.search + location.hash,
            viewport: `${innerWidth}x${innerHeight}`,
          }),
        });
        const data = await feedbackReceipt(response);
        const box = document.querySelector('#feedback-panel');
        box.replaceChildren(
          make('h2', { textContent: 'Thank you — it landed.' }),
          make('p', { textContent: data.screenshot ? 'Your note and the screenshot are with the team.' : 'Your note is with the team.' }),
          make('button', { type: 'button', className: 'button', textContent: 'Close', onclick: () => { box.remove(); open = false; } }),
        );
      } catch (error) {
        status.textContent = error.message; send.disabled = false;
      }
    };

    const close = make('button', { type: 'button', className: 'link feedback-close', textContent: 'Close', onclick: () => { document.querySelector('#feedback-panel')?.remove(); open = false; } });
    const box = make('section', { id: 'feedback-panel', role: 'dialog', ariaLabel: 'Send feedback' }, [
      make('h2', { textContent: 'What did you notice?' }),
      make('label', { htmlFor: 'feedback-kind', textContent: 'Kind' }), kind,
      make('label', { htmlFor: 'feedback-body', textContent: 'What happened' }), text,
      shoot, preview, status,
      make('div', { className: 'feedback-actions' }, [send, close]),
    ]);
    document.body.append(box);
    text.focus();
    box.addEventListener('keydown', event => { if (event.key === 'Escape') { box.remove(); open = false; } });
  }

  /** The board keeps a minimap in the corner this button wants. Sit above it rather than on it. */
  function clearOfTheMinimap(button) {
    const place = () => {
      const map = document.querySelector('#mm');
      const box = map?.getBoundingClientRect();
      const clear = box && box.height ? Math.round(innerHeight - box.top + 10) : null;
      button.style.bottom = clear ? `${clear}px` : '';
      const open = document.querySelector('#feedback-panel');
      if (open) open.style.bottom = button.style.bottom;
    };
    place();
    addEventListener('resize', place);
    // the minimap arrives with the board, after this runs
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  }

  async function mount() {
    if (!(await isHosted()) || document.querySelector('#feedback-open')) return;
    const button = make('button', { id: 'feedback-open', type: 'button', textContent: 'Feedback', title: 'Tell the team what you noticed' });
    button.onclick = panel;
    document.body.append(button);
    clearOfTheMinimap(button);
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();
})();
