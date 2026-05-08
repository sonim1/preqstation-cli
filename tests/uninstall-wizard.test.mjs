import test from "node:test";
import assert from "node:assert/strict";

import {
  promptUninstallPlan,
  runUninstallWizard,
} from "../src/uninstall-wizard.mjs";

test("promptUninstallPlan collects host and runtime removal selections", async () => {
  const multiselectCalls = [];

  const plan = await promptUninstallPlan({
    outputStream: { write: () => {}, isTTY: true },
    multiselectPrompt: async (config) => {
      multiselectCalls.push(config);
      return multiselectCalls.length === 1 ? ["openclaw", "hermes"] : ["codex"];
    },
  });

  assert.deepEqual(plan, {
    uninstallTargets: ["openclaw", "hermes"],
    runtimeEngines: ["codex"],
  });
  assert.match(multiselectCalls[0].message, /request entrypoints to uninstall/i);
  assert.match(multiselectCalls[1].message, /agent runtimes to remove/i);
});

test("runUninstallWizard removes selected hosts and runtime support", async () => {
  const calls = [];

  const result = await runUninstallWizard({
    outputStream: { write: () => {} },
    promptUninstallPlanFn: async () => ({
      uninstallTargets: ["openclaw", "hermes"],
      runtimeEngines: ["codex"],
    }),
    uninstallOpenClawPluginFn: async () => {
      calls.push("openclaw");
      return { ok: true, target: "openclaw", action: "removed" };
    },
    uninstallHermesSkillFn: async () => {
      calls.push("hermes");
      return { ok: true, target: "hermes", action: "removed" };
    },
    uninstallRuntimeMcpServersFn: async ({ runtimes }) => {
      calls.push(["mcp", ...runtimes]);
      return [{ ok: true, target: runtimes[0], action: "mcp_removed" }];
    },
    uninstallRuntimeWorkerSupportFn: async ({ runtimes }) => {
      calls.push(["support", ...runtimes]);
      return [{ ok: true, target: runtimes[0], action: "removed" }];
    },
  });

  assert.deepEqual(calls, [
    "openclaw",
    "hermes",
    ["mcp", "codex"],
    ["support", "codex"],
  ]);
  assert.deepEqual(result, {
    ok: true,
    action: "uninstalled",
    interactive: true,
    uninstall_targets: ["openclaw", "hermes"],
    runtime_engines: ["codex"],
    results: [
      { ok: true, target: "openclaw", action: "removed" },
      { ok: true, target: "hermes", action: "removed" },
      { ok: true, target: "codex", action: "mcp_removed" },
      { ok: true, target: "codex", action: "removed" },
    ],
  });
});
