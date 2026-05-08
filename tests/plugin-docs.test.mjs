import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function readRepoFile(name) {
  return fs.readFile(path.join(repoRoot, name), "utf8");
}

test("README describes the OpenClaw plugin install surface", async () => {
  const readme = await readRepoFile("README.md");
  const installation = await readRepoFile("INSTALLATION.md");

  assert.match(readme, /openclaw\.plugin\.json/);
  assert.match(readme, /before_dispatch/);
  assert.match(readme, /detached codex/i);
  assert.match(installation, /\/preqsetup set <PROJECT_KEY> <ABSOLUTE_PATH>/);
});

test("README no longer documents PTY background monitoring as the runtime path", async () => {
  const readme = await readRepoFile("README.md");

  assert.doesNotMatch(readme, /pty:true/i);
  assert.match(readme, /does not rely on OpenClaw `background:true` exec or `process action:poll` \/ `process action:log`/i);
});

test("SKILL describes detached launch instead of background PTY execution", async () => {
  const skill = await readRepoFile("SKILL.md");

  assert.match(skill, /detached/i);
  assert.match(skill, /Do not use `pty:true` \/ `background:true` for the coding run\./);
});

test("Hermes docs make Telegram delivery the primary integration path", async () => {
  const readme = await readRepoFile("README.md");
  const hermes = await readRepoFile("docs/hermes.md");
  const skill = await readRepoFile("SKILL.md");

  assert.match(readme, /Hermes Telegram/i);
  assert.match(readme, /webhook.*deferred/i);
  assert.match(hermes, /Telegram channel/i);
  assert.match(hermes, /\/preqstation_dispatch@PreqHermesBot/);
  assert.match(hermes, /Bot-to-Bot Communication Mode/i);
  assert.match(hermes, /Webhook.*deferred/i);
  assert.match(skill, /Telegram host such as Hermes/i);
  assert.doesNotMatch(hermes, /^# Hermes Webhook Setup$/m);
});
