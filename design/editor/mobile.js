/* Phone companion: keep the desktop workspace mounted so resizing never discards drafts. */
(() => {
  const phone = window.matchMedia('(max-width: 700px)');
  const hosted = !!document.querySelector('meta[name="staves-account"]');
  const previousInert = new Map();
  const pausedDialogs = new Set();
  let root, generation = 0, previousFocus;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link = board => new URL('./?board=' + encodeURIComponent(board), document.baseURI).href;
  const workspace = new URL('./workspace', document.baseURI).href;
  const docs = hosted ? '/docs/' : 'https://staves.io/docs/';
  // On a phone Staves is the marketing site, the documentation, and one board opened from a shared
  // link. Everything the workspace routes offer — the board list, the examples, the account page — is
  // work that needs a computer, so those say so rather than listing boards nobody can act on here.
  function phoneRoute(href) {
    const url = new URL(href, 'https://staves.invalid/');
    const board = (url.searchParams.get('board') || '').trim();
    return board ? {view:'board', board} : {view:'desktop'};
  }
  const route = phoneRoute(location.href);
  const boardId = route.view === 'board' ? route.board : '';
  // Capture before editor shortcuts: typing/copying still uses the browser's default behavior.
  window.addEventListener('keydown', event => { if (phone.matches) event.stopImmediatePropagation(); }, true);
  function protectDesktop() {
    for (const element of document.body.children) {
      if (element === root || ['SCRIPT','STYLE','LINK'].includes(element.tagName)) continue;
      if (!previousInert.has(element)) previousInert.set(element, element.inert);
      element.inert = true;
      if (element.tagName === 'DIALOG' && element.open) { pausedDialogs.add(element); element.close(); }
    }
  }
  async function get(path) {
    const response = await fetch(new URL(path, document.baseURI), {signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Could not load this saved view. Your access may have changed.');
    return response.json();
  }
  function shell() {
    root.innerHTML = '<header class="mobile-head"><a href="'+escape(workspace)+'" class="mobile-brand">staves</a><span>Mobile · Read only</span></header><main id="mobile-content" tabindex="-1"><p role="status">Loading saved work…</p></main><footer class="mobile-footer"><a href="'+escape(docs)+'">Documentation</a>'+(hosted?'<button id="mobile-signout">Sign out</button>':'')+'</footer>';
    root.querySelector('#mobile-signout')?.addEventListener('click', async event => {
      event.target.disabled = true;
      try {
        const response = await fetch('/auth/signout', {method:'POST'});
        if (!response.ok) throw new Error('Could not sign out. Try again.');
        ['key','provider','model','model-verified'].forEach(key => {localStorage.removeItem('staves:'+key);sessionStorage.removeItem('staves:'+key);});
        location.assign('/beta/');
      } catch { event.target.disabled=false; event.target.textContent='Retry sign out'; }
    });
  }
  function desktopNotice() {
    return '<aside class="mobile-desktop"><h2>Continue on desktop</h2><p>Read saved work here. Open Staves on a computer to model, edit, test scenarios or work with an agent.</p><button id="mobile-copy">Copy board link</button><p id="mobile-copy-status" role="status"></p></aside>';
  }
  // The whole page, because there is nothing else to show: no board was named, and a list of boards
  // would only offer work this device cannot do.
  function desktopOnlyMarkup() {
    return '<p class="mobile-eyebrow">Workspace</p><h1>Staves is a desktop tool</h1><p class="mobile-goal">Your boards are waiting on a computer; this link will open the same workspace there.</p><button id="mobile-copy">Copy workspace link</button><p id="mobile-copy-status" role="status"></p>';
  }
  function wireCopy() {
    root.querySelector('#mobile-copy').onclick = async () => {
      const url = boardId ? link(boardId) : workspace;
      const status = root.querySelector('#mobile-copy-status');
      try { await navigator.clipboard.writeText(url); status.textContent='Link copied. Open it on your computer.'; }
      catch { status.textContent='Copy this link: '; const input=document.createElement('input');input.value=url;input.readOnly=true;input.setAttribute('aria-label','Link to continue on desktop');status.append(input);input.focus();input.select(); }
    };
  }
  // Someone opening a board link on a phone is usually checking one thing: whether the request they
  // queued from a computer has been picked up yet. Only what the payloads actually say — an inbox that
  // could not be read is reported as unread rather than as an empty one.
  function statusBlock(requests, proposals) {
    const rows = Array.isArray(requests) ? requests.filter(item => item && item.request).map(item => ({id: item.request.id || 'unidentified', intent: item.request.intent || 'request', state: (item.delivery && item.delivery.status) || 'queued'})) : null;
    const pending = Array.isArray(proposals) ? proposals.length : null;
    const list = rows === null ? '<p class="mobile-note">Request status could not be read.</p>'
      : rows.length ? '<ul class="mobile-requests">'+rows.map(row => '<li><b>'+escape(row.intent)+'</b><span class="mobile-state" data-state="'+escape(row.state)+'">'+escape(row.state)+'</span><small>'+escape(row.id)+'</small></li>').join('')+'</ul>'
      : '<p>No agent requests on this board.</p>';
    return '<section class="mobile-status"><h2>Requests</h2>'+list+'<p class="mobile-note">'+(pending === null ? 'Pending proposals could not be read.' : pending+' pending proposal'+(pending===1?'':'s')+'.')+'</p></section>';
  }
  function boardMarkup(board, requests) {
    const jobs = (board.jobs || []).filter(job => !job.removed);
    const questions = (board.questions || []).filter(question => !['answered','done'].includes(question.status));
    const tracks = new Map((board.tracks || []).filter(track => !track.removed).map(track => [track.id,track]));
    const progress = board.context?.agentProgress;
    return '<p class="mobile-eyebrow">Workflow</p><h1>'+escape(board.title || board.id)+'</h1>'+statusBlock(requests, board.proposalsList)+'<p class="mobile-goal">'+escape(board.goal || board.context?.purpose || 'No workflow goal saved yet.')+'</p>'+desktopNotice()+'<section class="mobile-section"><h2>Saved design</h2><p>'+jobs.length+' jobs and tasks · '+tracks.size+' roles · '+questions.length+' open questions</p><p class="mobile-note">Description status is separate from implementation.</p>'+(progress?'<p><strong>Latest agent report</strong><br>'+escape(progress.summary)+'</p>':'')+'</section><section class="mobile-section"><h2>Work & responsibilities</h2>'+(jobs.length?jobs.map(job=>'<details class="mobile-job"><summary><span>'+escape(job.name)+'</span><small>'+escape(tracks.get(job.track)?.name || 'Role not specified')+'</small></summary><div>'+(job.parent?'<p class="mobile-note">Task in '+escape(jobs.find(parent=>parent.id===job.parent)?.name || 'another job')+'</p>':'')+'<p>'+escape(job.outcome || 'No outcome described yet.')+'</p><dl><dt>Description</dt><dd>'+escape(job.status || 'Not specified')+'</dd><dt>Implementation</dt><dd>'+escape(job.implementation?.state || 'unknown')+'</dd></dl>'+(job.doneWhen?.length?'<h3>Done when</h3><ul>'+job.doneWhen.map(item=>'<li>'+escape(item)+'</li>').join('')+'</ul>':'')+'</div></details>').join(''):'<p>No work has been modelled yet.</p>')+'</section><section class="mobile-section"><h2>Open questions</h2>'+(questions.length?'<ul class="mobile-questions">'+questions.map(question=>'<li>'+escape(question.text)+'</li>').join('')+'</ul>':'<p>No open questions saved.</p>')+'</section>';
  }
  async function load() {
    const current = ++generation;
    shell();
    const content = root.querySelector('#mobile-content');
    if (route.view !== 'board') { content.innerHTML = desktopOnlyMarkup(); wireCopy(); return; }
    try {
      // A failed inbox read must not blank the board: the status block says it is unread instead.
      const [board, requests] = await Promise.all([
        get('./board.json?board='+encodeURIComponent(boardId)),
        get('./assessment?board='+encodeURIComponent(boardId)).catch(() => null),
      ]);
      if (!phone.matches || current !== generation) return;
      content.innerHTML = boardMarkup(board, requests);
      wireCopy();
    } catch {
      if (!phone.matches || current !== generation) return;
      content.innerHTML='<h1>Saved work unavailable</h1><p>Check your connection and account access, then try again.</p><button id="mobile-retry">Retry</button>';
      root.querySelector('#mobile-retry').onclick=load;
    }
  }
  function change() {
    if (phone.matches) {
      previousFocus=document.activeElement;
      root.hidden=false;protectDesktop();
      // Render the companion even if an unmounted desktop voice control cannot repaint.
      try { if (typeof suspendConversationVoice === 'function') suspendConversationVoice(); }
      finally { load(); }
    } else {
      generation++;root.hidden=true;
      for (const [element,inert] of previousInert) element.inert=inert;
      previousInert.clear();
      for (const dialog of pausedDialogs) if (dialog.isConnected) dialog.showModal();
      pausedDialogs.clear();
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    root=document.createElement('div');root.id='mobile-companion';root.hidden=true;document.body.append(root);
    // Keep pointer events inside the companion out of desktop document-level handlers.
    for (const type of ['click','pointerdown','mousedown','touchstart']) root.addEventListener(type,event=>event.stopPropagation());
    new MutationObserver(() => {if(phone.matches)protectDesktop();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
    phone.addEventListener('change',change);change();
  });
})();
