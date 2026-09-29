// The workspace list is the first thing a person sees, and it was ordering itself differently from the
// server that fed it: the server sorts on touchedAt (when the board last changed here) and the client
// re-sorted on updatedAt (how old the work itself is). A board replayed in from another machine keeps
// its original timestamps, so it arrived at the top of the response and sank to the bottom of the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../home.js', import.meta.url), 'utf8');

function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, name + ' must be defined in home.js');
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const order = vm.createContext({});
vm.runInContext(['agentActivityAgo', 'boardStamp', 'compareBoards', 'boardEditedLabel'].map(name => extractFunction(source, name)).join('\n'), order);

const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const ago = minutes => new Date(NOW - minutes * 60000).toISOString();
const sorted = (boards, sort) => [...boards].sort((a, b) => order.compareBoards(sort, a, b)).map(board => board.id);

const replayed = { id: 'replayed', title: 'Replayed log', updatedAt: ago(60 * 24 * 30), touchedAt: ago(1) };
const edited = { id: 'edited', title: 'Edited here', updatedAt: ago(30), touchedAt: ago(30) };
const old = { id: 'old', title: 'Ancient', updatedAt: ago(60 * 24), touchedAt: ago(60 * 24) };

test('recently edited orders by when the board last changed in this workspace', () => {
  assert.deepEqual(sorted([old, edited, replayed], 'edited'), ['replayed', 'edited', 'old']);
});

test('a board with no touchedAt still orders by its own edit time', () => {
  const untouched = { id: 'untouched', title: 'No touch stamp', updatedAt: ago(5), touchedAt: null };
  assert.deepEqual(sorted([old, untouched, edited], 'edited'), ['untouched', 'edited', 'old']);
});

// A board with no timestamps is undated, not ancient. Reversing the comparator would have floated it
// to the top of "Oldest edit", which claims an edit date the log does not have. It sorts last either
// way, which is what the old '9999' fallback did on purpose.
test('oldest edit puts the oldest change first, and an undated board last in both directions', () => {
  const undated = { id: 'undated', title: 'No timestamps' };
  assert.deepEqual(sorted([old, undated, replayed], 'edited'), ['replayed', 'old', 'undated']);
  assert.deepEqual(sorted([old, undated, replayed], 'oldest'), ['old', 'replayed', 'undated']);
});

test('two undated boards fall back to name order rather than to whichever arrived first', () => {
  const zed = { id: 'zed', title: 'Zed' }, abe = { id: 'abe', title: 'Abe' };
  for (const sort of ['edited', 'oldest']) assert.deepEqual(sorted([zed, abe], sort), ['abe', 'zed']);
});

test('name A–Z is unchanged and ignores both timestamps', () => {
  assert.deepEqual(sorted([old, edited, replayed], 'name'), ['old', 'edited', 'replayed']);
});

test('an unknown sort falls back to recently edited rather than leaving the list unordered', () => {
  assert.deepEqual(sorted([old, replayed, edited], 'something-else'), ['replayed', 'edited', 'old']);
});

test('boards with no timestamps at all are ordered without throwing', () => {
  const blank = { id: 'blank', title: 'Blank' };
  assert.deepEqual(sorted([blank, edited], 'edited'), ['edited', 'blank']);
  assert.equal(order.boardStamp(blank), '');
});

test('the edit line reports the edit time, not the arrival time', () => {
  const label = order.boardEditedLabel(edited, NOW);
  assert.match(label, /^Edited /);
  assert.doesNotMatch(label, /arrived/);
});

test('a board whose log arrived later than it was edited says when it arrived', () => {
  const label = order.boardEditedLabel(replayed, NOW);
  assert.match(label, /^Edited /);
  assert.match(label, / · arrived 1 minute ago$/);
});

test('an arrival within a minute of the edit is the same event and is not reported twice', () => {
  const same = { id: 'same', title: 'Same', updatedAt: ago(30), touchedAt: new Date(Date.parse(ago(30)) + 59000).toISOString() };
  assert.doesNotMatch(order.boardEditedLabel(same, NOW), /arrived/);
});

test('a board with no edit date says so rather than printing an invalid date', () => {
  assert.equal(order.boardEditedLabel({ id: 'blank', title: 'Blank' }, NOW), 'Edit date unavailable');
  assert.equal(order.boardEditedLabel({ id: 'bad', title: 'Bad', updatedAt: ago(30), touchedAt: 'not a date' }, NOW).includes('arrived'), false);
});
