import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../generating.js', import.meta.url), 'utf8');

/** Enough DOM for one notice: ids, classes, children, and the head/chips the template declares. */
function make(tag, id = '') {
  const node = {
    tag, id, textContent: '', children: [], parent: null, dataset: {}, style: {setProperty() {}},
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); }, remove(name) { this.names.delete(name); },
      toggle(name, on) { if (on) this.names.add(name); else this.names.delete(name); },
      contains(name) { return this.names.has(name); },
    },
    setAttribute() {}, scrollIntoView() {},
    append(...kids) { for (const kid of kids) { kid.parent = node; node.children.push(kid); } },
    remove() { if (node.parent) node.parent.children = node.parent.children.filter(kid => kid !== node); node.parent = null; },
    replaceChildren(...kids) { node.children = kids; },
    querySelector: selector => find(node, selector),
  };
  Object.defineProperty(node, 'innerHTML', {
    get: () => node.html ?? '',
    // The only markup this file writes is the notice template; build what its own lookups expect.
    set(html) {
      node.html = html;
      node.children = [];
      if (String(html).includes('gen-what')) {
        const head = make('p'), what = make('span'), chips = make('div');
        head.classList.add('gen-head'); what.classList.add('gen-what'); chips.classList.add('gen-chips');
        head.append(what);
        node.append(head, chips);
      } else if (String(html).includes('<b>')) { // a chip: label and name
        node.append(make('i'), make('b'), make('span'));
      }
    },
  });
  return node;
}
function find(node, selector) {
  for (const kid of node.children ?? []) {
    const hit = selector.startsWith('#') ? kid.id === selector.slice(1)
      : selector.startsWith('.') ? kid.classList.contains(selector.slice(1))
      : kid.tag === selector;
    if (hit) return kid;
    const deeper = find(kid, selector);
    if (deeper) return deeper;
  }
  return null;
}

function surface({chatOpen = false} = {}) {
  const canvas = make('div', 'tl'), lines = make('div', 'ivlines'), panel = make('aside', 'conversation-panel');
  if (chatOpen) panel.classList.add('open');
  const roots = [canvas, panel, lines];
  const document = {
    createElement: tag => make(tag),
    querySelector(selector) {
      if (selector === '#conversation-panel.open') return panel.classList.contains('open') ? panel : null;
      if (selector === '#iv.show') return null;
      // The transcript is #ivlines inside #ivscroll; #iv-lines never existed.
      if (selector === '#ivscroll') return null;
      for (const root of roots) {
        if (selector.startsWith('#') && root.id === selector.slice(1)) return root;
        const hit = find(root, selector);
        if (hit) return hit;
      }
      return null;
    },
  };
  const window = {};
  vm.runInContext(source, vm.createContext({document, window, setTimeout, clearTimeout}));
  return {
    canvas, lines, api: window.stavesGenerating,
    get board() { return document.querySelector('#gen-board'); },
    get strip() { return document.querySelector('#gen-strip'); },
  };
}

test('with the conversation open, thinking shows in the conversation and not over the board', () => {
  const view = surface({chatOpen: true});
  view.api.thinking(true);
  assert.equal(view.board, null, 'nothing hovering over the canvas');
  assert.ok(view.strip, 'the notice is in the conversation');
  assert.equal(view.strip.parent, view.lines, 'the last line of the transcript, directly above the composer');
  assert.equal(view.strip.querySelector('.gen-what').textContent, 'Reading what you said…');
});

test('with the conversation closed, the same notice goes on the canvas', () => {
  const view = surface({chatOpen: false});
  view.api.thinking(true);
  assert.ok(view.board, 'the canvas says something is happening');
  assert.equal(view.board.parent, view.canvas);
  assert.equal(view.strip, null, 'no second copy in a conversation nobody is looking at');
});

test('named work keeps one home, and thinking clears without leaving a notice behind', async () => {
  const view = surface({chatOpen: true});
  view.api.thinking(true);
  view.api.start([{name: 'Tax advisor', ops: [{t: 'track'}]}]);
  assert.equal(view.board, null, 'still only in the conversation');
  assert.equal(view.strip.children.at(-1).children.length, 1, 'the role is named while it is being drawn');
  view.api.done(0);
  await new Promise(resolve => setTimeout(resolve, 5)); // done() lets the last state be read before it goes
  view.api.thinking(false);
  assert.equal(view.strip, null);
  assert.equal(view.board, null);
});
