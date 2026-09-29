import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function handoffHarness({ copyFails = false } = {}) {
  const nodes = new Map(), dialogs = [], requests = [], copies = [], timers = [];
  const node = () => ({ value: '', innerHTML: '', textContent: '', dataset: {}, setAttribute() {}, focus() {}, select() { this.selected = true; }, append() {}, replaceChildren() {}, addEventListener(event, fn) { this[event] = fn; } });
  const get = key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); };
  const memory = new Map();
  const context = vm.createContext({
    document: { activeElement: node(), body: node(), createElement: tag => {
      if (tag !== 'dialog') return node();
      const dialog = { ...node(), querySelector: get, showModal() { this.open = true; }, close() { this.open = false; this.closeEvent?.(); }, addEventListener(event, fn) { this[event === 'close' ? 'closeEvent' : event] = fn; } };
      dialogs.push(dialog); return dialog;
    } },
    state: { name: 'review-board', board: { title: 'Review invoices' }, multi: new Set(), sel: null },
    live: () => [{ id: 'a', name: 'Review', track: 'p' }, { id: 'b', name: 'Pay', track: 'p' }],
    trackOf: () => ({ name: 'Reviewer' }), job: () => null,
    $: get, $$: () => [], esc: String, ei: () => '', URL, Blob, AbortSignal,
    setInterval: fn => { const timer = { fn }; timers.push(timer); return timer; },
    clearInterval: timer => { if (timer) timer.cleared = true; }, setTimeout: () => {},
    window: {}, location: { href: 'https://staves.example/?board=review-board' },
    sessionStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
    navigator: { clipboard: { writeText: async text => { if (copyFails) throw new Error('Blocked'); copies.push(text); } } },
    fetch: async (url, options = {}) => {
      requests.push({ url, body: options.body ? JSON.parse(options.body) : undefined });
      if (url.startsWith('./agent-handoff')) return { ok: true, json: async () => ({ prompt: 'Read this board; discuss what to build.', requestId: 'request-1', board: 'review-board', title: 'Review invoices', revision: 17 }) };
      if (url.startsWith('./assessment')) return { ok: true, json: async () => ({ request: { id: 'request-1' }, delivery: { status: 'queued', actor: 'human' } }) };
      return { ok: true, json: async () => ({ packet: { board: { title: 'Review invoices' }, source: { revision: 17 }, warnings: [] }, formats: { markdown: 'Brief', json: '{}', svg: '<svg/>', n8n: '{}' } }) };
    },
  });
  vm.runInContext(readFileSync(new URL('../export.js', import.meta.url), 'utf8'), context);
  return { context, get, dialogs, requests, copies, timers, draft: () => vm.runInContext('handoffDraft', context) };
}
