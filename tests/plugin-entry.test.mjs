import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("native OpenClaw plugin manifest exists", async () => {
  const manifestPath = path.join(repoRoot, "openclaw.plugin.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  assert.equal(manifest.id, "preqstation-dispatcher");
  assert.equal(typeof manifest.name, "string");
  assert.equal(typeof manifest.description, "string");
  assert.deepEqual(manifest.configSchema.properties, {
    memoryPath: { type: "string" },
    projects: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    worktreeRoot: { type: "string" },
  });
});

test("plugin entry exports a native plugin definition", async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, "index.mjs")).href;
  const mod = await import(moduleUrl);
  const plugin = mod.default;

  assert.equal(plugin.id, "preqstation-dispatcher");
  assert.equal(typeof plugin.register, "function");
});

test("OpenClaw adapter exports the native plugin definition directly", async () => {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "src", "adapters", "openclaw", "index.mjs"),
  ).href;
  const mod = await import(moduleUrl);

  assert.equal(mod.default.id, "preqstation-dispatcher");
  assert.equal(typeof mod.default.register, "function");
  assert.equal(typeof mod.createBeforeDispatchHandler, "function");
  assert.equal(typeof mod.createPreqstationCommandHandler, "function");
});

test("OpenClaw plugin registers only the unified preqstation command", async () => {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "src", "adapters", "openclaw", "index.mjs"),
  ).href;
  const mod = await import(moduleUrl);
  const commands = [];

  mod.default.register({
    on() {},
    registerCommand(command) {
      commands.push(command);
    },
    runtime: {
      config: {
        loadConfig() {
          return {
            plugins: {
              entries: {
                "preqstation-dispatcher": {
                  enabled: true,
                  config: {
                    projects: {
                      PROJ: "/Users/example/projects/projects-manager",
                    },
                  },
                },
              },
            },
          };
        },
      },
    },
  });

  assert.deepEqual(
    commands.map((command) => command.name),
    ["preqstation"],
  );

  const help = await commands[0].handler({ args: "" });
  assert.match(help.text, /Usage: \/preqstation <command> \[args\]/);
  assert.match(help.text, /\/preqstation dispatch implement PROJ-123 using codex/);

  const setupStatus = await commands[0].handler({ args: "setup status" });
  assert.match(setupStatus.text, /Usage: \/preqstation setup set <PROJECT_KEY> <ABSOLUTE_PATH>/);
  assert.match(setupStatus.text, /PROJ -> \/Users\/example\/projects\/projects-manager/);
});
