// First run through the workspace, on driver.js. It runs once, remembers that it did, and can always
// be started again from the footer — an onboarding you cannot re-open is a thing people resent.
(() => {
  const SEEN = 'staves:tour-seen';
  const wait = (selector, ms = 4000) => new Promise(resolve => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const started = Date.now();
    const timer = setInterval(() => {
      const now = document.querySelector(selector);
      if (now || Date.now() - started > ms) { clearInterval(timer); resolve(now); }
    }, 120);
  });

  const steps = [
    {
      element: '.board-list, main',
      popover: {
        title: 'Your boards live here',
        description: 'A board shows one piece of work as the people in it experience it — who does what, what passes between them, and where it stalls. Everything you draw saves to this account.',
      },
    },
    {
      element: '[data-page="examples"]',
      popover: {
        title: 'Borrow a finished one',
        description: 'The example library has workflows already drawn. Opening one is the quickest way to see what a good board looks like before you make your own.',
      },
    },
    {
      element: '[data-page="docs"]',
      popover: {
        title: 'Connect your coding agent',
        description: 'The fastest way to draw a real workflow is to let the agent in your editor read the code and draw it for you. Bring in a coding agent walks through it — Node.js is all you install.',
      },
    },
    {
      element: '.account-link',
      popover: {
        title: 'Keys and connections',
        description: 'Two different things live here. An AI key, only needed when Staves interviews you in the browser. And a command line token, which is how your coding agent reaches these boards.',
      },
    },
    {
      element: '#feedback-open',
      popover: {
        title: 'Tell us what you noticed',
        description: 'Feedback goes straight to the team, and you can attach a screenshot of exactly what you are looking at. Use it while the thing is still in front of you.',
      },
    },
  ];

  async function run() {
    const { driver } = await import('./vendor/driver.js');
    // Skip anything this page does not have, so a missing element never dead-ends the tour.
    const present = [];
    for (const step of steps) if (await wait(step.element, 1200)) present.push(step);
    if (!present.length) return;
    driver({
      showProgress: true,
      allowClose: true,
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Start working',
      onDestroyed: () => { try { localStorage.setItem(SEEN, '1'); } catch {} },
      steps: present,
    }).drive();
  }

  function offer() {
    if (document.querySelector('#tour-start')) return;
    const button = document.createElement('button');
    button.id = 'tour-start'; button.type = 'button'; button.className = 'tour-start';
    button.textContent = 'Take the tour';
    button.onclick = run;
    (document.querySelector('footer') ?? document.body).append(button);
  }

  async function begin() {
    offer();
    let seen = '1';
    try { seen = localStorage.getItem(SEEN); } catch {}
    if (seen) return;
    // Give the board list a moment to arrive, so the first step points at something real.
    await wait('.board-list, .empty', 3000);
    run();
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', begin); else begin();
})();
