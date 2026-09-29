import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexConfig, codexServerEnv, installSkill, managedInstructions } from "../agent-setup.js";

test("the Codex launch environment can be read back, not only preserved", () => {
  const config = '[mcp_servers.other]\nENV = "no"\n[mcp_servers.staves]\ncommand = "npx"\nargs = ["mcp"]\n'
    + '[mcp_servers.staves.env]\nLANGFUSE_PUBLIC_KEY = "pk" # the public one\nLANGFUSE_SECRET_KEY = \'sk\'\n"QUOTED_KEY" = "v"\n[features]\nthing = true\n';
  assert.deepEqual(codexServerEnv(config), { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", QUOTED_KEY: "v" });
  assert.equal(codexServerEnv('[mcp_servers.staves]\nargs = ["mcp"]\n'), undefined, "no env table is not an empty one");
  assert.equal(codexServerEnv(""), undefined);
  assert.equal(codexServerEnv('[mcp_servers.staves.env]\n'), undefined, "an empty table carries no keys");
});

test("Codex project registration replaces only its own server and keeps unrelated settings", () => {
  const initial = 'model = "chosen"\n[mcp_servers.other]\ncommand = "other"\n[mcp_servers.staves]\ncommand = "old"\n[mcp_servers.staves.env]\nOLD = "value"\n[features]\nthing = true\n';
  const result = codexConfig(initial, ["-y", "@staves/cli@0.21.0", "mcp", "--connection", "connection-1"]);
  assert.match(result, /model = "chosen"/); assert.match(result, /command = "other"/);
  assert.match(result, /thing = true/); assert.doesNotMatch(result, /command = "old"/);
  assert.equal(result.split("[mcp_servers.staves]").length, 2);
  assert.equal(codexConfig(result, ["-y", "@staves/cli@0.21.0", "mcp", "--connection", "connection-1"]), result);
});

test("Codex registration keeps the launch environment the server was given", () => {
  const initial = '[mcp_servers.staves]\ncommand = "old"\nargs = ["stale"]\n[mcp_servers.staves.env]\nLANGFUSE_PUBLIC_KEY = "pk"\nLANGFUSE_SECRET_KEY = "sk"\n[other]\nkeep = 1\n';
  const result = codexConfig(initial, ["-y", "@staves/cli@0.21.0", "mcp", "--dir", "/tmp/.staves"]);
  assert.match(result, /\[mcp_servers\.staves\.env\]\nLANGFUSE_PUBLIC_KEY = "pk"\nLANGFUSE_SECRET_KEY = "sk"/);
  assert.match(result, /args = \["-y","@staves\/cli@0\.21\.0","mcp","--dir","\/tmp\/\.staves"\]/);
  assert.match(result, /keep = 1/); assert.doesNotMatch(result, /command = "old"|"stale"/);
  assert.equal(codexConfig(result, ["-y", "@staves/cli@0.21.0", "mcp", "--dir", "/tmp/.staves"]), result);
});

test("generated skill upgrades preserve user edits and publish current guidance beside them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "staves-skill-"));
  const file = path.join(root, "SKILL.md");
  try {
    assert.equal(await installSkill(file, "old generated"), true);
    assert.equal(await installSkill(file, "new generated"), true);
    assert.match(await readFile(file, "utf8"), /^new generated/);
    const custom = (await readFile(file, "utf8")).replace("new generated", "my custom rules");
    await writeFile(file, custom);
    assert.equal(await installSkill(file, "third generated"), false);
    assert.equal(await readFile(file, "utf8"), custom);
    assert.equal(await readFile(file + ".generated.md", "utf8"), "third generated");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("project instructions refresh their own block without changing surrounding content", () => {
  const initial = "# Our project\nKeep this.\n";
  const first = managedInstructions(initial, "Local instructions");
  const second = managedInstructions(first + "\nCustom tail", "Hosted instructions");
  assert.ok(second.startsWith(initial)); assert.ok(second.endsWith("Custom tail"));
  assert.doesNotMatch(second, /Local instructions/); assert.match(second, /Hosted instructions/);
});
