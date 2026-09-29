// tsc never deletes: a module removed from src/ would stay in dist/ and ship to npm. Start from nothing.
import { rmSync } from 'node:fs';
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
