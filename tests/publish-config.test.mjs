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

test("package metadata is publishable to the public npm registry", async () => {
  const pkg = JSON.parse(await readRepoFile("package.json"));

  assert.equal(pkg.name, "@sonim1/preqstation");
  assert.equal(pkg.private, false);
  assert.deepEqual(pkg.publishConfig, { access: "public" });
  assert.deepEqual(pkg.bin, {
    preqstation: "bin/preqstation.mjs",
  });
  assert.deepEqual(pkg.files, [
    "bin",
    "docs",
    "hermes-skills",
    "index.mjs",
    "src",
    "openclaw.plugin.json",
    "README.md",
    "MEMORY.md",
    "SKILL.md",
    "VERSION",
  ]);
});

test("README documents npm install as the default path and linked install for local development", async () => {
  const readme = await readRepoFile("README.md");

  assert.match(
    readme,
    /openclaw plugins install @sonim1\/preqstation --dangerously-force-unsafe-install/,
  );
  assert.match(readme, /OpenClaw plugin id is `preqstation-dispatcher`/);
  assert.match(readme, /Local linked install for active development/i);
});

test("publish workflow releases the package on main pushes", async () => {
  const workflow = await readRepoFile(".github/workflows/publish.yml");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:\s+branches:\s+- main/s);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s+publish-npm-package/);
  assert.match(workflow, /cancel-in-progress:\s+false/);
  assert.match(workflow, /id-token:\s+write/);
  assert.match(workflow, /github\.actor != 'github-actions\[bot\]'/);
  assert.match(workflow, /Install dependencies/);
  assert.match(workflow, /npm install/);
  assert.match(workflow, /npm version patch --no-git-tag-version/);
  assert.match(workflow, /writeFileSync\("VERSION", `\$\{pkg\.version\}\\n`\)/);
  assert.match(workflow, /git push/);
  assert.match(workflow, /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}"/);
  assert.match(workflow, /unset NODE_AUTH_TOKEN/);
  assert.match(workflow, /npm publish --access public/);
});
