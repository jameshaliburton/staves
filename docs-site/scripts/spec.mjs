// Publishes the Staves format schema at the URL it names as its $id
// (https://staves.io/spec/<version>/board.schema.json), so validators and editors can fetch it.
// Written into the site's public directory next to the docs; static files there are served before any rewrite.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(repo, 'spec/schema/board.schema.json');
const schema = JSON.parse(readFileSync(source, 'utf8'));
const id = new URL(schema.$id);
if (id.host !== 'staves.io' || !/^\/spec\/\d+\.\d+\/board\.schema\.json$/.test(id.pathname)) throw new Error(`Unexpected schema $id: ${schema.$id}`);
const target = path.join(repo, 'public', id.pathname);
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, readFileSync(source));
console.log(`schema published at ${id.pathname}`);
