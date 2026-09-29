import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { APP2_JS } from '../../../dist/app2.js';

/**
 * Every function the workspace calls has to exist somewhere in the workspace.
 *
 * This is here because stavesFab was deleted with five call sites left behind, and nothing noticed.
 * Every render() threw a ReferenceError, which took the button with it and — because the throw was
 * inside the paint chain — also stopped the live stream that is started from load().then(...). The
 * board silently stopped updating for anyone who did not reload, through a release.
 *
 * The existing editor tests all run a slice of one file against hand-built stubs, so a name that
 * exists in no file at all is exactly the thing they cannot see. This reads the whole shell the way
 * the page loads it and asks one question of it.
 */

const here = new URL('../', import.meta.url);

/** The page's own script order, read from the handler rather than repeated, so the two cannot drift. */
function shellScripts() {
  const handler = readFileSync(new URL('handler.mjs', here), 'utf8');
  const body = handler.slice(handler.indexOf(".replace('</body>'"));
  const names = [...body.matchAll(/<script src="\/([\w./-]+\.js)"><\/script>/g)].map(m => m[1]);
  assert.ok(names.includes('workspace.js'), 'the script list should come from the page the handler builds');
  return names;
}

const isIdentifier = node => node && ts.isIdentifier(node);

function collect(name, text, declared, called) {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const bind = node => {
    if (!node) return;
    if (ts.isIdentifier(node)) declared.add(node.text);
    else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) node.elements.forEach(el => bind(el.name ?? el));
  };
  const walk = node => {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node)) bind(node.name);
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) bind(node.name);
    if (ts.isCatchClause(node)) bind(node.variableDeclaration?.name);
    if (ts.isImportSpecifier(node) || ts.isImportClause(node)) bind(node.name);
    // `render=function(...)` and `timeline=function(...)`: the shell's way of wrapping app2's globals
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isIdentifier(node.left)) declared.add(node.left.text);
    // `window.foo=` / `globalThis.foo=`
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && isIdentifier(node.left.expression)
      && ['window', 'globalThis', 'self'].includes(node.left.expression.text)) declared.add(node.left.name.text);
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && isIdentifier(node.expression)) {
      called.set(node.expression.text, (called.get(node.expression.text) ?? []).concat(
        name + ':' + (file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)));
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
}

/** Names the browser or the language provides. Anything not here and not declared is a bug. */
const PROVIDED = new Set([
  'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'structuredClone', 'alert', 'confirm', 'prompt',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'RegExp', 'Error', 'TypeError', 'Symbol', 'BigInt',
  'Intl', 'Proxy', 'Reflect', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData',
  'Headers', 'Request', 'Response', 'AbortController', 'EventSource', 'WebSocket', 'Worker',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'Image', 'Audio', 'Option',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'DataTransfer', 'Node',
  'Text', 'Range', 'Uint8Array', 'Int32Array', 'Float64Array', 'ArrayBuffer', 'TextEncoder',
  'TextDecoder', 'btoa', 'atob', 'getComputedStyle', 'matchMedia', 'scrollTo', 'open', 'close',
  'print', 'focus', 'blur', 'postMessage', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'getSelection', 'crypto', 'performance', 'console', 'document', 'window',
  'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'require', 'import',
  'DOMParser', 'XMLSerializer', 'XMLHttpRequest', 'AbortSignal', 'Element', 'HTMLElement',
  'SpeechSynthesisUtterance', 'speechSynthesis', 'SpeechRecognition', 'webkitSpeechRecognition',
]);

test('every function the workspace calls is defined somewhere in the workspace', () => {
  const declared = new Set(PROVIDED);
  const called = new Map();
  const sources = [['app2.js', APP2_JS], ...shellScripts().map(n => [n, readFileSync(new URL(n, here), 'utf8')])];
  for (const [name, text] of sources) collect(name, text, declared, called);

  const missing = [...called].filter(([name]) => !declared.has(name))
    .map(([name, where]) => name + ' — called at ' + where.slice(0, 3).join(', '));

  assert.deepEqual(missing, [], 'these names are called but never defined:\n  ' + missing.join('\n  '));
});

test('the shell script list is the one the page actually serves', () => {
  const names = shellScripts();
  // workspace.js builds the header and the button into the conversation; it loading late enough to
  // see editor.js and navigation.js is what the rest of this file assumes
  assert.ok(names.indexOf('workspace.js') > names.indexOf('navigation.js'));
  assert.ok(names.indexOf('navigation.js') > names.indexOf('editor.js'));
});
