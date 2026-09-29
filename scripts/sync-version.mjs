#!/usr/bin/env node
// src/version.ts is the single VERSION the CLI, the MCP server and the browser bundle share, and
// `staves init` / `staves connect` write it into people's MCP config as `staves@<VERSION>`. If it
// drifts from package.json, every generated config pins a version that was never published and npx
// fails on their machine. The browser bundle imports it too, so it cannot read package.json at
// runtime — it is generated here instead, before every build.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const target = new URL("src/version.ts", root);
const next = `export const VERSION = ${JSON.stringify(version)};\n`;
const current = readFileSync(target, "utf8");

if (current === next) process.exit(0);
writeFileSync(target, next);
console.log(`version: src/version.ts -> ${version}`);
