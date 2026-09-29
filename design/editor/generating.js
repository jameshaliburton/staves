// What is being built, while it is being built.
//
// Generation used to be silent: the model thought, the ops posted, the board reloaded, and
// everything appeared at once. Several seconds of nothing reads as broken rather than as busy — so
// the work announces itself as soon as it is known, on the board and in the conversation, and each
// piece settles as it lands.
(() => {
  const KIND = {
    job: ['Job', '#eed4a4'],
    task: ['Task', '#c5ecff'],
    role: ['Role', '#a3a8ef'],
    connection: ['Connection', '#69d8e7'],
    information: ['Information', '#b8dcd9'],
    change: ['Change', '#9db0bd'],
  };

  /** What a card is about to add, in the words the board uses. */
  function readCard(card) {
    const ops = card?.ops ?? [];
    const has = t => ops.some(o => o.t === t);
    const kind =
      ops.some(o => o.t === 'job' && o.job?.parent) ? 'task'
      : has('job') ? 'job'
      : has('track') ? 'role'
      : ops.some(o => o.t === 'handover' || o.t === 'link') ? 'connection'
      : has('artifact') ? 'information'
      : 'change';
    return { kind, name: card?.name || KIND[kind][0] };
  }

  const state = { items: [], thinking: false, mounted: false };
  // The workspace shell has no #board; its canvas is #tl. Mounted on body, the notice covers the status bar.
  const canvasHost = () => document.querySelector('#board') ?? document.querySelector('#tl') ?? document.body;
  // Feedback belongs where the person is looking. With the conversation open that is the conversation,
  // right above the composer they just typed into; with it closed, the canvas. Never both at once.
  const chatHost = () => (document.querySelector('#conversation-panel.open') ?? document.querySelector('#iv.show'))
    ? document.querySelector('#ivlines') ?? document.querySelector('#ivscroll') ?? document.querySelector('#iv')
    : null;
  function notice(tag, id) {
    const el = document.createElement(tag);
    el.id = id; el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<p class="gen-head"><span class="gen-pulse" aria-hidden="true"></span><span class="gen-what"></span></p><div class="gen-chips"></div>`;
    return el;
  }

  function chip(item) {
    const [label, colour] = KIND[item.kind] ?? KIND.change;
    const el = document.createElement('span');
    el.className = 'gen-chip';
    el.dataset.name = item.name;
    el.style.setProperty('--gen-tint', colour);
    el.innerHTML = `<i aria-hidden="true"></i><b></b><span></span>`;
    el.querySelector('b').textContent = label;
    el.querySelector('span').textContent = item.name;
    return el;
  }

  function paint() {
    let board = document.querySelector('#gen-board');
    let strip = document.querySelector('#gen-strip');
    if (!state.items.length && !state.thinking) { board?.remove(); strip?.remove(); state.mounted = false; return; }

    const conversation = chatHost();
    if (conversation) { board?.remove(); board = null; }
    else if (strip) { strip.remove(); strip = null; }
    if (conversation && !strip) conversation.append(strip = notice('div', 'gen-strip'));
    if (!conversation && !board) canvasHost().append(board = notice('aside', 'gen-board'));

    const left = state.items.filter(i => !i.settled).length;
    const summary = !state.items.length
      ? 'Reading what you said…'
      : left ? `Drawing ${left} ${left === 1 ? 'thing' : 'things'} on the board…`
      : 'Everything landed.';
    for (const host of [board, strip]) {
      if (!host) continue;
      host.querySelector('.gen-what').textContent = summary;
      host.classList.toggle('done', !!state.items.length && !left);
      const chips = host.querySelector('.gen-chips');
      chips.replaceChildren(...state.items.map(item => {
        const el = chip(item);
        el.classList.toggle('settled', !!item.settled);
        return el;
      }));
    }
    strip?.scrollIntoView?.({ block: 'nearest' });
  }

  const api = {
    /** Announce what is coming, before any of it exists. */
    start(cards) {
      state.items = (cards ?? []).map(readCard);
      state.thinking = false;
      state.mounted = true;
      paint();
      return state.items.length;
    },
    /** Thinking, with nothing named yet. */
    thinking(on) {
      if (on && state.items.length) return;
      state.thinking = !!on;
      paint();
    },
    /** One piece has landed on the real board. */
    settle(name) {
      const item = state.items.find(i => !i.settled && (!name || i.name === name));
      if (item) { item.settled = true; paint(); }
    },
    /** All of it landed, or the attempt ended. Let the last state be readable before it goes. */
    done(delay = 1100) {
      state.items.forEach(i => { i.settled = true; });
      state.thinking = false;
      paint();
      setTimeout(() => { state.items = []; paint(); }, delay);
    },
    /** It failed. Say so where the promise was made, rather than leaving it spinning. */
    failed(message) {
      const hosts = [document.querySelector('#gen-board'), document.querySelector('#gen-strip')].filter(Boolean);
      for (const host of hosts) {
        host.classList.add('failed');
        host.querySelector('.gen-what').textContent = message || 'That did not land. Nothing was changed.';
      }
      state.items = [];
      state.thinking = false;
      setTimeout(() => hosts.forEach(h => h.remove()), 4000);
    },
  };

  window.stavesGenerating = api;
})();
