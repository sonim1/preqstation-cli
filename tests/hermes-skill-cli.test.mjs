import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDispatcherCli } from "../src/cli/preqstation-dispatcher.mjs";
import {
  syncHermesSkill,
  uninstallHermesSkill,
} from "../src/hermes-skill-installer.mjs";

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("install hermes copies the bundled PREQ dispatch skill with provenance", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-install-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install", "hermes"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { HERMES_HOME: hermesHome },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  const skillFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation",
    "SKILL.md",
  );
  const metadataFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation",
    ".preqstation-dispatcher.json",
  );

  assert.equal(exitCode, 0);
  const skillText = await fs.readFile(skillFile, "utf8");
  assert.match(skillText, /name: preqstation/);
  assert.match(skillText, /\/preqstation dispatch/);
  assert.doesNotMatch(skillText, /\/preqstation_dispatch/);
  assert.doesNotMatch(skillText, /\/preq_dispatch/);
  assert.match(skillText, /npx -y @sonim1\/preqstation@latest run/);
  assert.doesNotMatch(skillText, /\bpreqstation run/);
  assert.match(skillText, /comment_id/);
  assert.match(skillText, /--comment-id/);

  const metadata = await readJson(metadataFile);
  assert.equal(metadata.package, "@sonim1/preqstation");
  assert.equal(metadata.source, "bundled");
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/u);

  const result = JSON.parse(stdout.join(""));
  assert.equal(result.ok, true);
  assert.equal(result.target, "hermes");
  assert.equal(result.action, "installed");
  assert.equal(result.skill_file, skillFile);
  assert.equal(result.metadata_file, metadataFile);
});

test("uninstallHermesSkill removes the managed Hermes skill", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-uninstall-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const env = { PREQSTATION_HERMES_HOME: hermesHome };
  const skillFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation",
    "SKILL.md",
  );

  await syncHermesSkill({ env });
  const result = await uninstallHermesSkill({ env });

  assert.deepEqual(result, {
    ok: true,
    target: "hermes",
    action: "removed",
    skill_file: skillFile,
  });
  await assert.rejects(fs.stat(skillFile), /ENOENT/);
});

test("uninstallHermesSkill backs up locally modified skills when forced", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-uninstall-force-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const env = { PREQSTATION_HERMES_HOME: hermesHome };
  const skillFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation",
    "SKILL.md",
  );

  await syncHermesSkill({ env });
  await fs.appendFile(skillFile, "\nLocal operator note.\n", "utf8");

  await assert.rejects(
    uninstallHermesSkill({ env }),
    /Hermes skill has local changes/,
  );

  const result = await uninstallHermesSkill({ env, force: true });

  assert.equal(result.ok, true);
  assert.equal(result.action, "removed");
  assert.match(result.backup_file, /preqstation\.bak-\d+\.SKILL\.md$/);
  await assert.rejects(fs.stat(skillFile), /ENOENT/);
  assert.match(await fs.readFile(result.backup_file, "utf8"), /Local operator note/);
});

test("install runs the interactive wizard when no target is provided", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-install-cli-"));
  const stdout = [];
  let called = false;

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: path.join(tempDir, "projects.json"),
      PREQSTATION_REPO_ROOTS: tempDir,
    },
    runInstallWizard: async () => {
      called = true;
      return {
        ok: true,
        action: "installed",
        interactive: true,
        install_targets: ["hermes"],
        runtime_engines: ["codex"],
        preqstation_server_url: "https://preq.example.com",
        mcp_url: "https://preq.example.com/mcp",
        results: [
          { ok: true, target: "hermes", action: "installed" },
          { ok: true, target: "codex", action: "mcp_installed" },
        ],
      };
    },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
    fetchPreqstationProjectsFn: async () => [
      { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
    ],
  });

  const result = JSON.parse(stdout.join(""));

  assert.equal(exitCode, 0);
  assert.equal(called, true);
  assert.deepEqual(result.install_targets, ["hermes"]);
  assert.deepEqual(result.runtime_engines, ["codex"]);
  assert.equal(result.mcp_url, "https://preq.example.com/mcp");
  assert.equal(result.project_setup.project_source, "preqstation_mcp");
});

test("install renders a friendly summary for interactive tty output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-install-summary-"));
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 240 },
    stderr: { write: () => {} },
    env: {
      FORCE_COLOR: "1",
      PREQSTATION_PROJECTS_FILE: path.join(tempDir, "projects.json"),
      PREQSTATION_REPO_ROOTS: tempDir,
    },
    runInstallWizard: async () => ({
      ok: true,
      action: "installed",
      interactive: true,
      install_targets: ["openclaw", "hermes"],
      runtime_engines: ["claude-code", "codex"],
      preqstation_server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      results: [
        {
          ok: true,
          target: "openclaw",
          action: "updated",
          installed_version: "0.1.19",
          package_version: "0.1.20",
          restart_command: "openclaw gateway restart",
        },
        { ok: true, target: "hermes", action: "already_current", version: "0.1.20" },
        { ok: true, target: "claude-code", action: "already_current", installed_version: "0.1.37" },
        { ok: true, target: "claude-code", action: "mcp_already_configured" },
        { ok: true, target: "codex", action: "installed", latest_version: "0.1.37" },
      ],
    }),
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
    fetchPreqstationProjectsFn: async () => [
      { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
    ],
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);

  assert.equal(exitCode, 0);
  assert.match(plain, /Install summary/);
  assert.match(plain, /Request entrypoints/);
  assert.match(plain, /OpenClaw\s+updated\s+0\.1\.19 -> 0\.1\.20, restart: openclaw gateway restart/);
  assert.match(plain, /Hermes Agent\s+current\s+0\.1\.20/);
  assert.match(plain, /Agent runtimes/);
  assert.match(plain, /Claude Code\s+current\s+plugin current 0\.1\.37/);
  assert.match(plain, /Codex\s+installed\s+skill installed 0\.1\.37/);
  assert.match(plain, /MCP/);
  assert.match(plain, /Endpoint\s+https:\/\/preq\.example\.com\/mcp/);
  assert.match(plain, /Claude Code MCP\s+configured/);
  assert.match(plain, /Project Setup/);
  assert.match(plain, /PREQ projects\s+configured\s+0 matched, 1 unmatched/);
  assert.match(plain, /Install complete/);
  assert.match(rendered, /\u001B\[38;2;34;211;238mOpenClaw\u001B\[0m/);
  assert.match(rendered, /\u001B\[38;2;16;163;127mCodex\u001B\[0m/);
  assert.match(rendered, /\u001B\[32mupdated\u001B\[0m/);
  assert.doesNotMatch(plain, /^\{/m);
});

test("install summary surfaces when the local repo is newer than the published OpenClaw plugin", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 240 },
    stderr: { write: () => {} },
    runInstallWizard: async () => ({
      ok: true,
      action: "installed",
      interactive: true,
      install_targets: ["openclaw"],
      runtime_engines: [],
      preqstation_server_url: null,
      mcp_url: null,
      results: [
        {
          ok: true,
          target: "openclaw",
          action: "already_current",
          installed_version: "0.1.21",
          package_version: "0.1.21",
          local_package_version: "0.1.24",
          restart_command: "openclaw gateway restart",
        },
      ],
    }),
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
    fetchPreqstationProjectsFn: async () => {
      throw new Error("install must not fetch PREQ projects without a server URL");
    },
    resolveDefaultPreqstationServerUrlFn: async () => null,
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);

  assert.equal(exitCode, 0);
  assert.match(plain, /OpenClaw\s+current\s+0\.1\.21, restart: openclaw gateway restart, local repo: 0\.1\.24 unpublished/);
});

test("install returns a non-zero exit code when the interactive wizard reports failed runtime setup", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    runInstallWizard: async () => ({
      ok: false,
      action: "installed",
      interactive: true,
      install_targets: ["hermes"],
      runtime_engines: ["codex"],
      preqstation_server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      results: [
        { ok: true, target: "hermes", action: "installed" },
        {
          ok: false,
          target: "codex",
          action: "failed",
          error: "preqstation skill did not become enabled for Codex after install",
        },
      ],
    }),
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(exitCode, 1);
  assert.equal(result.ok, false);
});

test("sync hermes refuses user-modified skills unless forced", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-sync-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const env = { HERMES_HOME: hermesHome };
  const noopDispatch = async () => {
    throw new Error("skill install must not dispatch");
  };

  assert.equal(
    await runDispatcherCli({
      argv: ["install", "hermes"],
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      env,
      dispatchPreqRun: noopDispatch,
    }),
    0,
  );

  const skillFile = path.join(
    hermesHome,
    "skills",
    "preqstation",
    "preqstation",
    "SKILL.md",
  );
  await fs.appendFile(skillFile, "\n# local note\n", "utf8");

  const stderr = [];
  const rejectedExitCode = await runDispatcherCli({
    argv: ["sync", "hermes"],
    stdout: { write: () => {} },
    stderr: { write: (value) => stderr.push(value) },
    env,
    dispatchPreqRun: noopDispatch,
  });

  assert.equal(rejectedExitCode, 1);
  assert.match(stderr.join(""), /Hermes skill has local changes/);

  const stdout = [];
  const forcedExitCode = await runDispatcherCli({
    argv: ["sync", "hermes", "--force"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env,
    dispatchPreqRun: noopDispatch,
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(forcedExitCode, 0);
  assert.equal(result.action, "updated");
  assert.match(result.backup_file, /SKILL\.md\.bak-/u);
  assert.match(await fs.readFile(skillFile, "utf8"), /name: preqstation/);
  assert.doesNotMatch(await fs.readFile(skillFile, "utf8"), /# local note/);
});

test("status hermes reports whether the installed skill is current", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-hermes-status-"));
  const hermesHome = path.join(tempDir, ".hermes");
  const env = { HERMES_HOME: hermesHome };
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["status", "hermes"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env,
    dispatchPreqRun: async () => {
      throw new Error("status must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    target: "hermes",
    installed: false,
    current: false,
    user_modified: false,
    skill_file: path.join(
      hermesHome,
      "skills",
      "preqstation",
      "preqstation",
      "SKILL.md",
    ),
    metadata_file: path.join(
      hermesHome,
      "skills",
      "preqstation",
      "preqstation",
      ".preqstation-dispatcher.json",
    ),
  });
});

test("update refreshes installed surfaces without installing missing ones", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-update-refresh-"));
  const stdout = [];
  const runtimeCalls = [];
  const runtimeExecutableCalls = [];

  const exitCode = await runDispatcherCli({
    argv: ["update"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: path.join(tempDir, "projects.json"),
      PREQSTATION_REPO_ROOTS: tempDir,
    },
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: false,
      current: false,
      user_modified: false,
      skill_file: "/tmp/hermes/SKILL.md",
      metadata_file: "/tmp/hermes/.preqstation-dispatcher.json",
    }),
    installOpenClawPluginFn: async ({ updateOnly }) => ({
      ok: true,
      target: "openclaw",
      action: updateOnly ? "updated" : "installed",
      installed_version: "0.1.20",
      package_version: "0.1.22",
      restart_command: "openclaw gateway restart",
    }),
    installRuntimeWorkerSupportFn: async ({ runtimes, installMissing }) => {
      runtimeCalls.push({ runtimes, installMissing });
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [{ ok: true, target: runtime, action: "already_current", installed_version: "0.1.38" }];
      }
      if (runtime === "codex") {
        return [{ ok: true, target: runtime, action: "updated", installed_version: "0.1.37", latest_version: "0.1.38" }];
      }
      return [{ ok: true, target: runtime, action: "not_installed", latest_version: "0.1.38" }];
    },
    inspectRuntimeExecutableHealthFn: async ({ runtimes, launchHosts }) => {
      runtimeExecutableCalls.push({ runtimes, launchHosts });
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "claude",
            resolved_path: "/Users/kendrick/.local/bin/claude",
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "codex",
            resolved_path: "/Users/kendrick/.local/bin/codex",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          category: "runtime_executable",
          action: "needs_attention",
          executable: "gemini",
          resolved_path: "/Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini",
          alternate_path: "/Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini",
          error:
            "OpenClaw, Hermes Agent dispatches may not inherit /Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini (session-scoped fnm path). Expose /Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini via /usr/local/bin/gemini or another stable PATH entry.",
        },
      ];
    },
    inspectRuntimeMcpServersFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "Connected",
            auth: null,
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "enabled",
            auth: "OAuth",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          action: "mcp_missing",
          server_url: null,
          mcp_url: null,
          connection_status: null,
          auth: null,
        },
      ];
    },
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    fetchPreqstationProjectsFn: async () => [
      { projectKey: "MISS", repoUrl: "https://github.com/sonim1/missing-repo" },
    ],
    dispatchPreqRun: async () => {
      throw new Error("update must not dispatch");
    },
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(exitCode, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.host_targets, ["openclaw", "hermes"]);
  assert.deepEqual(result.runtime_engines, ["claude-code", "codex", "gemini-cli"]);
  assert.deepEqual(runtimeCalls, [
    { runtimes: ["claude-code"], installMissing: false },
    { runtimes: ["codex"], installMissing: false },
    { runtimes: ["gemini-cli"], installMissing: false },
  ]);
  assert.deepEqual(runtimeExecutableCalls, [
    { runtimes: ["claude-code"], launchHosts: ["openclaw", "hermes"] },
    { runtimes: ["codex"], launchHosts: ["openclaw", "hermes"] },
    { runtimes: ["gemini-cli"], launchHosts: ["openclaw", "hermes"] },
  ]);
  assert.deepEqual(
    result.results.map((entry) => ({ target: entry.target, action: entry.action })),
    [
      { target: "openclaw", action: "updated" },
      { target: "hermes", action: "not_installed" },
      { target: "claude-code", action: "already_current" },
      { target: "codex", action: "updated" },
      { target: "gemini-cli", action: "not_installed" },
      { target: "claude-code", action: "ready" },
      { target: "codex", action: "ready" },
      { target: "gemini-cli", action: "needs_attention" },
      { target: "claude-code", action: "mcp_configured" },
      { target: "codex", action: "mcp_configured" },
      { target: "gemini-cli", action: "mcp_missing" },
    ],
  );
  assert.equal(result.server_url, "https://preq.example.com");
  assert.equal(result.mcp_url, "https://preq.example.com/mcp");
  assert.equal(result.project_setup.project_source, "preqstation_mcp");
});

test("update runs setup auto from PREQ projects after refreshing installed surfaces", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-update-auto-"));
  const mappingPath = path.join(tempDir, "projects.json");
  const repoRoot = path.join(tempDir, "repos");
  const projectPath = path.join(repoRoot, "projects-manager");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:sonim1/projects-manager.git"],
    { cwd: projectPath, stdio: "ignore" },
  );

  const stdout = [];
  const projectFetches = [];
  const exitCode = await runDispatcherCli({
    argv: ["update"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: mappingPath,
      PREQSTATION_REPO_ROOTS: repoRoot,
    },
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: false,
      skill_file: "/tmp/hermes/SKILL.md",
      metadata_file: "/tmp/hermes/.preqstation-dispatcher.json",
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "not_installed",
    }),
    installRuntimeWorkerSupportFn: async ({ runtimes }) => [
      { ok: true, target: runtimes[0], action: "not_installed" },
    ],
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) => [
      { ok: true, target: runtimes[0], category: "runtime_executable", action: "unavailable" },
    ],
    inspectRuntimeMcpServersFn: async ({ runtimes }) => [
      { ok: true, target: runtimes[0], action: "mcp_missing", mcp_url: null },
    ],
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    fetchPreqstationProjectsFn: async (options) => {
      projectFetches.push(options);
      return [
        { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
        { projectKey: "MISS", repoUrl: "https://github.com/sonim1/missing-repo" },
      ];
    },
    dispatchPreqRun: async () => {
      throw new Error("update must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(projectFetches.length, 1);
  assert.equal(projectFetches[0].serverUrl, "https://preq.example.com");
  assert.deepEqual(JSON.parse(await fs.readFile(mappingPath, "utf8")), {
    projects: {
      PROJ: projectPath,
    },
  });
  const result = JSON.parse(stdout.join(""));
  assert.deepEqual(result.project_setup.matched, {
    PROJ: projectPath,
  });
  assert.deepEqual(result.project_setup.unmatched, [
    {
      projectKey: "MISS",
      repoUrl: "https://github.com/sonim1/missing-repo",
    },
  ]);
  assert.equal(result.project_setup.project_source, "preqstation_mcp");
});

test("update renders a friendly summary for interactive tty output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-update-summary-"));
  const repoRoot = path.join(tempDir, "repos");
  const projectPath = path.join(repoRoot, "projects-manager");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:sonim1/projects-manager.git"],
    { cwd: projectPath, stdio: "ignore" },
  );
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["update"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 240 },
    stderr: { write: () => {} },
    env: {
      FORCE_COLOR: "1",
      PREQSTATION_PROJECTS_FILE: path.join(tempDir, "projects.json"),
      PREQSTATION_REPO_ROOTS: repoRoot,
    },
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: true,
    }),
    syncHermesSkillFn: async () => ({
      ok: true,
      target: "hermes",
      action: "already_current",
      version: "0.1.22",
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "not_installed",
      package_version: "0.1.22",
    }),
    installRuntimeWorkerSupportFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [{ ok: true, target: runtime, action: "unavailable", error: "claude command not found" }];
      }
      if (runtime === "codex") {
        return [{ ok: true, target: runtime, action: "updated", installed_version: "0.1.37", latest_version: "0.1.38" }];
      }
      return [
        {
          ok: true,
          target: runtime,
          action: "not_enabled",
          installed_version: "0.1.38",
          latest_version: "0.1.38",
          configured_agents: ["Claude Code"],
        },
      ];
    },
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "claude",
            resolved_path: "/Users/kendrick/.local/bin/claude",
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            category: "runtime_executable",
            action: "ready",
            executable: "codex",
            resolved_path: "/Users/kendrick/.local/bin/codex",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          category: "runtime_executable",
          action: "needs_attention",
          executable: "gemini",
          resolved_path: "/Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini",
          alternate_path: "/Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini",
          error:
            "OpenClaw, Hermes Agent dispatches may not inherit /Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini (session-scoped fnm path). Expose /Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini via /usr/local/bin/gemini or another stable PATH entry.",
        },
      ];
    },
    inspectRuntimeMcpServersFn: async ({ runtimes }) => {
      const [runtime] = runtimes;
      if (runtime === "claude-code") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "Connected",
            auth: null,
          },
        ];
      }
      if (runtime === "codex") {
        return [
          {
            ok: true,
            target: runtime,
            action: "mcp_configured",
            server_url: "https://preq.example.com",
            mcp_url: "https://preq.example.com/mcp",
            connection_status: "enabled",
            auth: "OAuth",
          },
        ];
      }
      return [
        {
          ok: true,
          target: runtime,
          action: "mcp_configured",
          server_url: "https://preq.example.com",
          mcp_url: "https://preq.example.com/mcp",
          connection_status: "Disconnected",
          auth: null,
        },
      ];
    },
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    fetchPreqstationProjectsFn: async () => [
      { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
      { projectKey: "MISS", repoUrl: "https://github.com/sonim1/missing-repo" },
    ],
    dispatchPreqRun: async () => {
      throw new Error("update must not dispatch");
    },
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);
  assert.equal(exitCode, 0);
  assert.match(plain, /Update summary/);
  assert.match(plain, /Update complete/);
  assert.match(plain, /Settings/);
  assert.match(plain, /Server URL\s+https:\/\/preq\.example\.com/);
  assert.match(plain, /MCP endpoint\s+https:\/\/preq\.example\.com\/mcp/);
  assert.match(plain, /Request entrypoints/);
  assert.match(plain, /OpenClaw\s+not installed/);
  assert.match(plain, /Hermes Agent\s+current\s+0\.1\.22/);
  assert.match(plain, /Agent runtimes/);
  assert.match(plain, /Claude Code\s+unavailable\s+plugin unavailable claude command not found, CLI ready \/Users\/kendrick\/\.local\/bin\/claude/);
  assert.match(plain, /Codex\s+updated\s+skill updated 0\.1\.37 -> 0\.1\.38, CLI ready \/Users\/kendrick\/\.local\/bin\/codex/);
  assert.match(plain, /Gemini CLI\s+attention\s+skill not enabled 0\.1\.38, installed globally, not enabled for Gemini CLI, CLI attention/);
  assert.doesNotMatch(plain, /Claude Code CLI\s+ready/);
  assert.doesNotMatch(plain, /Codex CLI\s+ready/);
  assert.match(plain, /\/Users\/kendrick\/\.local\/state\/fnm_multishells\/12345\/bin\/gemini/);
  assert.match(plain, /stable path:[\s\S]*\/Users\/kendrick\/\.local\/share\/fnm\/node-versions\/v24\.13\.0\/installation\/bin\/gemini/);
  assert.match(plain, /OpenClaw, Hermes[\s\S]*Agent dispatches may not/);
  assert.match(plain, /MCP/);
  assert.match(plain, /Claude Code MCP\s+configured\s+https:\/\/preq\.example\.com\/mcp, status: Connected/);
  assert.match(plain, /Codex MCP\s+configured\s+https:\/\/preq\.example\.com\/mcp, status: enabled, auth: OAuth/);
  assert.match(plain, /Gemini CLI MCP\s+configured\s+https:\/\/preq\.example\.com\/mcp, status: Disconnected/);
  assert.match(plain, /Project Setup/);
  assert.match(plain, /PREQ projects\s+configured\s+1 matched, 1 unmatched/);
  assert.match(plain, /Matched Projects/);
  assert.match(plain, new RegExp(`PROJ\\s+mapped\\s+${escapeRegExp(projectPath)}`));
  assert.match(plain, /Unmatched Projects/);
  assert.match(plain, /MISS\s+unmatched\s+https:\/\/github\.com\/sonim1\/missing-repo/);
  assert.match(rendered, /\u001B\[38;2;217;119;87mClaude Code\u001B\[0m/);
  assert.match(rendered, /\u001B\[38;2;71;150;227mGemini CLI\u001B\[0m/);
  assert.match(rendered, /\u001B\[33mattention\u001B\[0m/);
  assert.doesNotMatch(plain, /^\{/m);
});

test("update reports an interactive plan and progress steps", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-update-progress-"));
  const repoRoot = path.join(tempDir, "repos");
  const projectPath = path.join(repoRoot, "projects-manager");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:sonim1/projects-manager.git"],
    { cwd: projectPath, stdio: "ignore" },
  );
  const stdout = [];
  const notes = [];
  const progress = [];
  const spinnerOptions = [];
  const clackUi = {
    note: (body, title, options) => notes.push({ body, title, output: options.output }),
    spinner: (options) => {
      spinnerOptions.push(options);
      return {
        start: (message) => progress.push(["start", message]),
        stop: (message) => progress.push(["stop", message]),
        error: (message) => progress.push(["error", message]),
      };
    },
    box: (body, title) => stdout.push(`${title}\n${body}\n`),
    outro: (message) => stdout.push(`${message}\n`),
  };

  const exitCode = await runDispatcherCli({
    argv: ["update"],
    stdout: { write: (value) => stdout.push(value), isTTY: true },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: path.join(tempDir, "projects.json"),
      PREQSTATION_REPO_ROOTS: repoRoot,
    },
    clackUi,
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: false,
      skill_file: "/tmp/hermes/SKILL.md",
      metadata_file: "/tmp/hermes/.preqstation-dispatcher.json",
    }),
    installOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "not_installed",
    }),
    installRuntimeWorkerSupportFn: async ({ runtimes }) => [
      { ok: true, target: runtimes[0], action: "not_installed" },
    ],
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) => [
      { ok: true, target: runtimes[0], category: "runtime_executable", action: "unavailable" },
    ],
    inspectRuntimeMcpServersFn: async ({ runtimes }) => [
      { ok: true, target: runtimes[0], action: "mcp_missing", mcp_url: null },
    ],
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    fetchPreqstationProjectsFn: async () => [
      { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
    ],
    dispatchPreqRun: async () => {
      throw new Error("update must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Update plan");
  assert.equal(notes[0].output.isTTY, true);
  assert.match(notes[0].body, /Refresh installed request entrypoints/);
  assert.match(notes[0].body, /Update installed agent runtime support/);
  assert.match(notes[0].body, /Refresh project mappings from PREQ MCP/);
  assert.deepEqual(progress, [
    ["start", "Refreshing request entrypoints"],
    ["stop", "Request entrypoints refreshed"],
    ["start", "Updating agent runtime support"],
    ["stop", "Agent runtime support updated"],
    ["start", "Checking agent CLI paths"],
    ["stop", "Agent CLI paths checked"],
    ["start", "Checking MCP registrations"],
    ["stop", "MCP registrations checked"],
    ["start", "Resolving PREQSTATION server URL"],
    ["stop", "PREQSTATION server URL resolved"],
    ["start", "Refreshing project mappings"],
    ["stop", "Project mappings refreshed"],
  ]);
  assert.deepEqual(
    spinnerOptions.map(({ frames, delay }) => ({ frames, delay })),
    Array.from({ length: 6 }, () => ({ frames: ["-", "\\", "|", "/"], delay: 120 })),
  );
  assert.match(stdout.join(""), /Update summary/);
});
