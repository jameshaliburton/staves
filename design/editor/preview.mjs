/** Persistent local review workspace using the actual shipped editor. */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store } from '../../dist/store.js';
import { editorHandler } from './handler.mjs';
import { seedNodeStress } from '../mockups/node-stress-fixture.mjs';

const port = Number(process.env.STAVES_PREVIEW_PORT || 4325);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('STAVES_PREVIEW_PORT must be an integer between 1024 and 65535.');
const dir = fileURLToPath(new URL('../../.staves/visual-preview/', import.meta.url));
const store = new Store(dir);
// The fixture seeds only an absent board; existing edits and history stay intact.
await seedNodeStress(store);
const server = http.createServer(editorHandler(store));
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Preview port ${port} is already in use. Choose STAVES_PREVIEW_PORT or use the running preview.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}/?board=node-stress`);
  console.log(`Preview edits are retained in ${dir}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
