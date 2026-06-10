import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDispatcherCli } from "../src/cli/preqstation-dispatcher.mjs";
import { DispatchError } from "../src/dispatch-error.mjs";

const packageJsonPath = new URL("../package.json", import.meta.url);

async function readCurrentPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  return pkg.version;
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("prints the package version for --version", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["--version"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
  });

  assert.equal(exitCode, 0);
  assert.equal(stdout.join(""), `${await readCurrentPackageVersion()}\n`);
});

test("prints the package version for -v", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["-v"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
  });

  assert.equal(exitCode, 0);
  assert.equal(stdout.join(""), `${await readCurrentPackageVersion()}\n`);
});

test("prints grouped help with the public preqstation command name", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["--help"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
  });

  const help = stdout.join("");
  assert.equal(exitCode, 0);
  assert.match(help, /PREQSTATION/);
  assert.match(help, new RegExp(`Version ${await readCurrentPackageVersion()}`));
  assert.match(help, /Install & Update/);
  assert.match(help, /Project Setup/);
  assert.match(help, /Direct Dispatch \(run without OpenClaw\/Hermes\)/);
  assert.match(help, /Info/);
  assert.match(help, /Advanced:/);
  assert.match(help, /preqstation uninstall\s*$/m);
  assert.match(help, /preqstation status\s*$/m);
  assert.match(help, /preqstation doctor\s*$/m);
  assert.match(help, /preqstation setup auto\s*$/m);
  assert.match(help, /preqstation install hermes/);
  assert.match(help, /preqstation uninstall openclaw/);
  assert.match(help, /preqstation sync hermes/);
  assert.match(help, /preqstation run --project-key PROJ/);
  assert.doesNotMatch(help, /^Usage:/m);
  assert.doesNotMatch(help, /preqstation-dispatcher run/);
});

test("status reports overall install state instead of requiring hermes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-status-"));
  const projectPath = path.join(tempDir, "project");
  const mappingPath = path.join(tempDir, "projects.json");
  await fs.mkdir(projectPath);
  await fs.writeFile(mappingPath, `${JSON.stringify({ projects: { PROJ: projectPath } })}\n`);

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["status", "--json"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PREQSTATION_PROJECTS_FILE: mappingPath, PREQSTATION_TOKEN: "test-token" },
    inspectOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "already_current",
      installed_version: "0.1.36",
      package_version: "0.1.36",
    }),
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: true,
      current: true,
      installed_version: "0.1.36",
    }),
    inspectRuntimeWorkerSupportFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "already_current",
        installed_version: "0.1.45",
      })),
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: "ready",
        resolved_path: `/usr/local/bin/${runtime}`,
      })),
    inspectRuntimeMcpServersFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "mcp_configured",
        mcp_url: "https://preq.example.com/mcp",
      })),
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    dispatchPreqRun: async () => {
      throw new Error("status must not dispatch");
    },
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(exitCode, 0);
  assert.equal(result.action, "status");
  assert.equal(result.server_url, "https://preq.example.com");
  assert.equal(result.project_mappings.total, 1);
  assert.deepEqual(
    result.results.map(({ target, action }) => ({ target, action })),
    [
      { target: "openclaw", action: "already_current" },
      { target: "hermes", action: "already_current" },
      { target: "claude-code", action: "already_current" },
      { target: "codex", action: "already_current" },
      { target: "gemini-cli", action: "already_current" },
      { target: "claude-code", action: "ready" },
      { target: "codex", action: "ready" },
      { target: "gemini-cli", action: "ready" },
      { target: "claude-code", action: "mcp_configured" },
      { target: "codex", action: "mcp_configured" },
      { target: "gemini-cli", action: "mcp_configured" },
    ],
  );
});

test("status reports interactive progress while checking install state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-status-progress-"));
  const projectPath = path.join(tempDir, "project");
  const mappingPath = path.join(tempDir, "projects.json");
  await fs.mkdir(projectPath);
  await fs.writeFile(mappingPath, `${JSON.stringify({ projects: { PROJ: projectPath } })}\n`);

  const stdout = [];
  const progress = [];
  const clackUi = {
    spinner: () => ({
      start: (message) => progress.push(["start", message]),
      stop: (message) => progress.push(["stop", message]),
      error: (message) => progress.push(["error", message]),
    }),
    log: {
      step: (message) => stdout.push(`${message}\n`),
    },
    box: (body, title) => stdout.push(`${title}\n${body}\n`),
    note: (body, title) => stdout.push(`${title}\n${body}\n`),
    outro: (message) => stdout.push(`${message}\n`),
  };

  const exitCode = await runDispatcherCli({
    argv: ["status"],
    stdout: { write: (value) => stdout.push(value), isTTY: true },
    stderr: { write: () => {} },
    env: { PREQSTATION_PROJECTS_FILE: mappingPath, PREQSTATION_TOKEN: "test-token" },
    clackUi,
    inspectOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "already_current",
    }),
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: true,
      current: true,
    }),
    inspectRuntimeWorkerSupportFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({ ok: true, target: runtime, action: "already_current" })),
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: "ready",
        resolved_path: `/usr/local/bin/${runtime}`,
      })),
    inspectRuntimeMcpServersFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "mcp_configured",
        mcp_url: "https://preq.example.com/mcp",
      })),
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    dispatchPreqRun: async () => {
      throw new Error("status must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(progress, [
    ["start", "Checking PREQSTATION server URL"],
    ["stop", "PREQSTATION server URL checked"],
    ["start", "Checking project mappings"],
    ["stop", "Project mappings checked"],
    ["start", "Checking CLI auth"],
    ["stop", "CLI auth checked"],
    ["start", "Checking worker CLI auth"],
    ["stop", "Worker CLI auth checked"],
    ["start", "Checking request entrypoints"],
    ["stop", "Request entrypoints checked"],
    ["start", "Checking agent runtime support"],
    ["stop", "Agent runtime support checked"],
    ["start", "Checking agent CLI paths"],
    ["stop", "Agent CLI paths checked"],
    ["start", "Checking legacy MCP registrations"],
    ["stop", "Legacy MCP registrations checked"],
  ]);
  assert.match(stdout.join(""), /Status summary/);
});

test("doctor reports read-only dispatcher health as json", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-doctor-"));
  const projectPath = path.join(tempDir, "project");
  const missingPath = path.join(tempDir, "missing");
  const mappingPath = path.join(tempDir, "projects.json");
  await fs.mkdir(projectPath);
  await fs.writeFile(
    mappingPath,
    `${JSON.stringify({ projects: { PROJ: projectPath, MISS: missingPath } }, null, 2)}\n`,
  );

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["doctor", "--json"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PREQSTATION_PROJECTS_FILE: mappingPath },
    inspectOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "already_current",
      installed_version: "0.1.36",
      package_version: "0.1.36",
    }),
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: true,
      current: true,
      installed_version: "0.1.36",
    }),
    inspectRuntimeWorkerSupportFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "already_current",
        installed_version: "0.1.45",
      })),
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: "ready",
        resolved_path: `/usr/local/bin/${runtime}`,
      })),
    inspectRuntimeMcpServersFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        action: "mcp_configured",
        mcp_url: "https://preq.example.com/mcp",
      })),
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    dispatchPreqRun: async () => {
      throw new Error("doctor must not dispatch");
    },
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(exitCode, 1);
  assert.equal(result.action, "doctor");
  assert.equal(result.server_url, "https://preq.example.com");
  assert.deepEqual(result.project_mappings.missing, [
    { project_key: "MISS", project_path: missingPath },
  ]);
  assert.deepEqual(
    result.results.map(({ target, action }) => ({ target, action })),
    [
      { target: "openclaw", action: "already_current" },
      { target: "hermes", action: "already_current" },
      { target: "claude-code", action: "already_current" },
      { target: "codex", action: "already_current" },
      { target: "gemini-cli", action: "already_current" },
      { target: "claude-code", action: "ready" },
      { target: "codex", action: "ready" },
      { target: "gemini-cli", action: "ready" },
      { target: "claude-code", action: "mcp_configured" },
      { target: "codex", action: "mcp_configured" },
      { target: "gemini-cli", action: "mcp_configured" },
    ],
  );
});

test("doctor renders a grouped interactive summary", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-doctor-tty-"));
  const projectPath = path.join(tempDir, "project");
  const mappingPath = path.join(tempDir, "projects.json");
  await fs.mkdir(projectPath);
  await fs.writeFile(mappingPath, `${JSON.stringify({ projects: { PROJ: projectPath } })}\n`);

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["doctor"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 180 },
    stderr: { write: () => {} },
    env: { FORCE_COLOR: "1", PREQSTATION_PROJECTS_FILE: mappingPath },
    inspectOpenClawPluginFn: async () => ({
      ok: true,
      target: "openclaw",
      action: "not_installed",
    }),
    getHermesSkillStatusFn: async () => ({
      ok: true,
      target: "hermes",
      installed: true,
      current: true,
      installed_version: "0.1.36",
    }),
    inspectRuntimeWorkerSupportFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({ ok: true, target: runtime, action: "not_installed" })),
    inspectRuntimeExecutableHealthFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({
        ok: true,
        target: runtime,
        category: "runtime_executable",
        action: "ready",
        resolved_path: `/usr/local/bin/${runtime}`,
      })),
    inspectRuntimeMcpServersFn: async ({ runtimes }) =>
      runtimes.map((runtime) => ({ ok: true, target: runtime, action: "mcp_missing" })),
    resolveDefaultPreqstationServerUrlFn: async () => null,
    dispatchPreqRun: async () => {
      throw new Error("doctor must not dispatch");
    },
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);
  assert.equal(exitCode, 1);
  assert.match(plain, /Doctor summary/);
  assert.match(plain, /Settings/);
  assert.match(plain, /Project Setup/);
  assert.match(plain, /Mapped Projects/);
  assert.match(plain, new RegExp(`PROJ\\s+ready\\s+${escapeRegExp(projectPath)}`));
  assert.match(plain, /Request entrypoints/);
  assert.match(plain, /Hermes Agent\s+current\s+0\.1\.36/);
  assert.match(plain, /Agent runtimes/);
  assert.match(plain, /MCP/);
  assert.match(plain, /Next steps/);
  assert.match(plain, /Run\s+preqstation install/);
  assert.doesNotMatch(plain, /^\{/m);
});

test("prints colored grouped help for TTY output", async () => {
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["help"],
    stdout: {
      write: (value) => stdout.push(value),
      isTTY: true,
      columns: 160,
    },
    stderr: { write: () => {} },
    env: { FORCE_COLOR: "1" },
  });

  const help = stdout.join("");
  assert.equal(exitCode, 0);
  assert.match(help, /\u001B\[38;2;16;163;127mpreqstation\u001B\[0m/);
  assert.match(help, /\u001B\[38;2;245;158;11mPROJ\u001B\[0m/);
  assert.match(help, /\u001B\[38;2;167;139;250mAdvanced:\u001B\[0m/);
  assert.match(help, /\u001B\[38;2;34;211;238m/);
});

test("run-json dispatches a Hermes payload through the shared runtime", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-cli-"));
  const payloadPath = path.join(tempDir, "payload.json");
  await fs.writeFile(
    payloadPath,
    JSON.stringify({
      event_type: "preq.dispatch.requested",
      dispatch: {
        objective: "implement",
        project_key: "PROJ",
        task_key: "PROJ-123",
        engine: "codex",
      },
    }),
  );

  const stdout = [];
  const calls = [];
  const exitCode = await runDispatcherCli({
    argv: ["run-json", "--payload", payloadPath],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: path.join(tempDir, "projects.json"),
      PREQSTATION_WORKTREE_ROOT: path.join(tempDir, "worktrees"),
    },
    dispatchPreqRun: async (params) => {
      calls.push(params);
      return {
        prepared: { cwd: "/tmp/worktree", branchName: "preqstation/proj/task-proj-123" },
        launch: { pid: 4242, pidFile: "/tmp/worktree/pid", logFile: "/tmp/worktree/log" },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parsed.taskKey, "PROJ-123");
  assert.equal(calls[0].parsed.engine, "codex");
  assert.equal(calls[0].sharedMappingPath, path.join(tempDir, "projects.json"));
  assert.equal(calls[0].worktreeRoot, path.join(tempDir, "worktrees"));
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    project_key: "PROJ",
    task_key: "PROJ-123",
    engine: "codex",
    cwd: "/tmp/worktree",
    branch_name: "preqstation/proj/task-proj-123",
    pid: 4242,
    log_file: "/tmp/worktree/log",
    pid_file: "/tmp/worktree/pid",
  });
});

test("run-json serializes typed dispatch failures to stdout JSON", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-cli-error-"));
  const payloadPath = path.join(tempDir, "payload.json");
  await fs.writeFile(
    payloadPath,
    JSON.stringify({
      event_type: "preq.dispatch.requested",
      dispatch: {
        objective: "implement",
        project_key: "PROJ",
        task_key: "PROJ-123",
        engine: "codex",
      },
    }),
  );

  const stdout = [];
  const stderr = [];
  const exitCode = await runDispatcherCli({
    argv: ["run-json", "--payload", payloadPath],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
    dispatchPreqRun: async () => {
      throw new DispatchError(
        "stale_dispatch_branch",
        "Dispatch branch task/proj-123 is stale relative to origin/main.",
        {
          branch_name: "task/proj-123",
          base_ref: "origin/main",
          worktree_path: path.join(tempDir, "worktrees", "PROJ", "task-proj-123"),
          safe_to_delete: true,
          suggested_action: "delete_branch_and_retry",
          commands: [`git -C ${tempDir} branch -D task/proj-123`],
        },
      );
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: false,
    error: {
      code: "stale_dispatch_branch",
      message: "Dispatch branch task/proj-123 is stale relative to origin/main.",
      branch_name: "task/proj-123",
      base_ref: "origin/main",
      worktree_path: path.join(tempDir, "worktrees", "PROJ", "task-proj-123"),
      safe_to_delete: true,
      suggested_action: "delete_branch_and_retry",
      commands: [`git -C ${tempDir} branch -D task/proj-123`],
    },
  });
  assert.match(
    stderr.join(""),
    /error \[stale_dispatch_branch\]: Dispatch branch task\/proj-123 is stale/,
  );
});

test("setup set writes a public shared mapping file without platform-specific config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-setup-"));
  const mappingPath = path.join(tempDir, "projects.json");
  const projectPath = path.join(tempDir, "project");
  await fs.mkdir(projectPath);

  const exitCode = await runDispatcherCli({
    argv: ["setup", "set", "proj", projectPath],
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    env: { PREQSTATION_PROJECTS_FILE: mappingPath },
    dispatchPreqRun: async () => {
      throw new Error("setup must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(mappingPath, "utf8")), {
    projects: {
      PROJ: projectPath,
    },
  });
});

test("setup auto maps discovered repositories into the shared mapping file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-auto-"));
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
  const exitCode = await runDispatcherCli({
    argv: [
      "setup",
      "auto",
      "PROJ=https://github.com/sonim1/projects-manager",
      "MISS=https://github.com/sonim1/missing-repo",
    ],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: mappingPath,
      PREQSTATION_REPO_ROOTS: repoRoot,
    },
    dispatchPreqRun: async () => {
      throw new Error("setup must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(mappingPath, "utf8")), {
    projects: {
      PROJ: projectPath,
    },
  });
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    mapping_file: mappingPath,
    matched: {
      PROJ: projectPath,
    },
    unmatched: [
      {
        projectKey: "MISS",
        repoUrl: "https://github.com/sonim1/missing-repo",
      },
    ],
    invalid: [],
    projects: {
      PROJ: projectPath,
    },
    repo_roots: [repoRoot],
  });
});

test("setup auto fetches PREQ projects when repo hints are omitted", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-mcp-auto-"));
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
    argv: ["setup", "auto"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: mappingPath,
      PREQSTATION_REPO_ROOTS: repoRoot,
      PREQSTATION_SERVER_URL: "https://preq.example.com",
    },
    dispatchPreqRun: async () => {
      throw new Error("setup must not dispatch");
    },
    fetchPreqstationProjectsFn: async (options) => {
      projectFetches.push(options);
      return [
        { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
        { projectKey: "MISS", repoUrl: "https://github.com/sonim1/missing-repo" },
      ];
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
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    mapping_file: mappingPath,
    matched: {
      PROJ: projectPath,
    },
    unmatched: [
      {
        projectKey: "MISS",
        repoUrl: "https://github.com/sonim1/missing-repo",
      },
    ],
    invalid: [],
    projects: {
      PROJ: projectPath,
    },
    repo_roots: [repoRoot],
    project_source: "preqstation_mcp",
  });
});

test("setup auto renders saved and unmatched projects for interactive tty output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-mcp-auto-tty-"));
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
  const exitCode = await runDispatcherCli({
    argv: ["setup", "auto"],
    stdout: { write: (value) => stdout.push(value), isTTY: true, columns: 160 },
    stderr: { write: () => {} },
    env: {
      FORCE_COLOR: "1",
      PREQSTATION_PROJECTS_FILE: mappingPath,
      PREQSTATION_REPO_ROOTS: repoRoot,
      PREQSTATION_SERVER_URL: "https://preq.example.com",
    },
    dispatchPreqRun: async () => {
      throw new Error("setup must not dispatch");
    },
    fetchPreqstationProjectsFn: async () => [
      { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
      { projectKey: "MISS", repoUrl: "https://github.com/sonim1/missing-repo" },
    ],
  });

  const rendered = stdout.join("");
  const plain = stripAnsi(rendered);
  assert.equal(exitCode, 0);
  assert.match(plain, /Project Setup/);
  assert.match(plain, /PREQ projects\s+configured\s+1 matched, 1 unmatched/);
  assert.match(plain, /Matched Projects/);
  assert.match(plain, new RegExp(`PROJ\\s+mapped\\s+${escapeRegExp(projectPath)}`));
  assert.match(plain, /Unmatched Projects/);
  assert.match(plain, /MISS\s+unmatched\s+https:\/\/github\.com\/sonim1\/missing-repo/);
  assert.match(plain, /Setup complete/);
  assert.doesNotMatch(plain, /^\{/m);
});

test("install runs setup auto from PREQ projects after the wizard completes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-install-auto-"));
  const dispatchHome = path.join(tempDir, "dispatch");
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
    argv: ["install"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: mappingPath,
      PREQSTATION_REPO_ROOTS: repoRoot,
      PREQSTATION_DISPATCH_HOME: dispatchHome,
    },
    runInstallWizard: async () => ({
      ok: true,
      action: "installed",
      interactive: false,
      install_targets: ["openclaw"],
      runtime_engines: ["codex"],
      preqstation_server_url: "https://preq.example.com",
      mcp_url: "https://preq.example.com/mcp",
      results: [],
    }),
    fetchPreqstationProjectsFn: async (options) => {
      projectFetches.push(options);
      return [
        { projectKey: "PROJ", repoUrl: "https://github.com/sonim1/projects-manager" },
        { projectKey: "MISS", repoUrl: "https://github.com/sonim1/missing-repo" },
      ];
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
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dispatchHome, "config.json"), "utf8")), {
    server_url: "https://preq.example.com",
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

test("uninstall runs the interactive wizard when no target is provided", async () => {
  const stdout = [];
  let called = false;

  const exitCode = await runDispatcherCli({
    argv: ["uninstall"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PREQSTATION_PROJECTS_FILE: "/tmp/preqstation-projects.json" },
    runUninstallWizard: async () => {
      called = true;
      return {
        ok: true,
        action: "uninstalled",
        interactive: true,
        uninstall_targets: ["openclaw"],
        runtime_engines: ["codex"],
        results: [
          { ok: true, target: "openclaw", action: "removed" },
          { ok: true, target: "codex", action: "mcp_removed" },
          { ok: true, target: "codex", action: "removed" },
        ],
      };
    },
    dispatchPreqRun: async () => {
      throw new Error("uninstall must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(called, true);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    action: "uninstalled",
    interactive: true,
    uninstall_targets: ["openclaw"],
    runtime_engines: ["codex"],
    projects_file: "/tmp/preqstation-projects.json",
    results: [
      { ok: true, target: "openclaw", action: "removed" },
      { ok: true, target: "codex", action: "mcp_removed" },
      { ok: true, target: "codex", action: "removed" },
    ],
  });
});

test("uninstall openclaw runs the OpenClaw remover", async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runDispatcherCli({
    argv: ["uninstall", "openclaw"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PATH: process.env.PATH },
    uninstallOpenClawPluginFn: async ({ env }) => {
      calls.push(env);
      return {
        ok: true,
        target: "openclaw",
        action: "removed",
        plugin_id: "preqstation-dispatcher",
        restart_command: "openclaw gateway restart",
      };
    },
    dispatchPreqRun: async () => {
      throw new Error("uninstall must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ PATH: process.env.PATH }]);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    target: "openclaw",
    action: "removed",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
  });
});

test("setup set uses the user's shared mapping path outside Hermes profile HOME", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-hermes-home-set-"),
  );
  const userHome = path.join(tempDir, "user-home");
  const hermesHome = path.join(userHome, ".hermes", "profiles", "preq-coder");
  const hermesSubprocessHome = path.join(hermesHome, "home");
  const projectPath = path.join(tempDir, "project");
  const mappingPath = path.join(userHome, ".preqstation-dispatch", "projects.json");

  await fs.mkdir(hermesSubprocessHome, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });

  const exitCode = await runDispatcherCli({
    argv: ["setup", "set", "proj", projectPath],
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    env: {
      HOME: hermesSubprocessHome,
      HERMES_HOME: hermesHome,
    },
    dispatchPreqRun: async () => {
      throw new Error("setup must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(mappingPath, "utf8")), {
    projects: {
      PROJ: projectPath,
    },
  });
});

test("setup auto scans the user's projects root outside Hermes profile HOME", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-hermes-home-auto-"),
  );
  const userHome = path.join(tempDir, "user-home");
  const hermesHome = path.join(userHome, ".hermes", "profiles", "preq-coder");
  const hermesSubprocessHome = path.join(hermesHome, "home");
  const repoRoot = path.join(userHome, "projects");
  const projectPath = path.join(repoRoot, "projects-manager");
  const mappingPath = path.join(userHome, ".preqstation-dispatch", "projects.json");

  await fs.mkdir(hermesSubprocessHome, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:sonim1/projects-manager.git"],
    { cwd: projectPath, stdio: "ignore" },
  );

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["setup", "auto", "PROJ=https://github.com/sonim1/projects-manager"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      HOME: hermesSubprocessHome,
      HERMES_HOME: hermesHome,
    },
    dispatchPreqRun: async () => {
      throw new Error("setup must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(mappingPath, "utf8")), {
    projects: {
      PROJ: projectPath,
    },
  });
  assert.deepEqual(JSON.parse(stdout.join("")).repo_roots, [repoRoot]);
});

test("run-json uses the user's shared mapping path outside Hermes profile HOME", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-hermes-home-run-"),
  );
  const userHome = path.join(tempDir, "user-home");
  const hermesHome = path.join(userHome, ".hermes", "profiles", "preq-coder");
  const hermesSubprocessHome = path.join(hermesHome, "home");
  const mappingPath = path.join(userHome, ".preqstation-dispatch", "projects.json");
  const payloadPath = path.join(tempDir, "payload.json");

  await fs.mkdir(hermesSubprocessHome, { recursive: true });
  await fs.writeFile(
    payloadPath,
    JSON.stringify({
      event_type: "preq.dispatch.requested",
      dispatch: {
        objective: "implement",
        project_key: "PROJ",
        task_key: "PROJ-123",
        engine: "codex",
      },
    }),
  );

  const calls = [];
  const exitCode = await runDispatcherCli({
    argv: ["run-json", "--payload", payloadPath],
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    env: {
      HOME: hermesSubprocessHome,
      HERMES_HOME: hermesHome,
      PREQSTATION_WORKTREE_ROOT: path.join(tempDir, "worktrees"),
    },
    dispatchPreqRun: async (params) => {
      calls.push(params);
      return {
        prepared: { cwd: "/tmp/worktree", branchName: "preqstation/proj/task-proj-123" },
        launch: { pid: 4242, pidFile: "/tmp/worktree/pid", logFile: "/tmp/worktree/log" },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sharedMappingPath, mappingPath);
});

test("mcp call invokes PREQ MCP through the shared OAuth cache", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-mcp-call-"));
  const userHome = path.join(tempDir, "user-home");
  const calls = [];
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["mcp", "call", "preq_get_task", "--json", '{"taskId":"PROJ-123"}'],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      HOME: userHome,
      PREQSTATION_DISPATCH_HOME: path.join(userHome, ".preqstation-dispatch"),
    },
    resolveDefaultPreqstationServerUrlFn: async () => "https://preq.example.com",
    callPreqstationMcpToolFn: async (params) => {
      calls.push(params);
      return { task: { key: "PROJ-123" } };
    },
    dispatchPreqRun: async () => {
      throw new Error("mcp call must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].serverUrl, "https://preq.example.com");
  assert.equal(calls[0].oauthPath, path.join(userHome, ".preqstation-dispatch", "oauth.json"));
  assert.equal(calls[0].toolName, "preq_get_task");
  assert.deepEqual(calls[0].toolArguments, { taskId: "PROJ-123" });
  assert.deepEqual(JSON.parse(stdout.join("")), { task: { key: "PROJ-123" } });
});

test("mcp disable removes only the legacy runtime MCP registration", async () => {
  const calls = [];
  const stdout = [];

  const exitCode = await runDispatcherCli({
    argv: ["mcp", "disable", "codex"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PATH: process.env.PATH },
    uninstallRuntimeMcpServersFn: async ({ env, runtimes }) => {
      calls.push(["mcp", env, runtimes]);
      return [{ ok: true, target: "codex", action: "mcp_removed" }];
    },
    uninstallRuntimeWorkerSupportFn: async () => {
      throw new Error("mcp disable must not uninstall worker support");
    },
    dispatchPreqRun: async () => {
      throw new Error("mcp disable must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [["mcp", { PATH: process.env.PATH }, ["codex"]]]);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    action: "mcp_disabled",
    runtime_engines: ["codex"],
    results: [{ ok: true, target: "codex", action: "mcp_removed", legacy: true }],
  });
});

test("auth status reports server URL, inspected home, and OAuth cache readiness", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-auth-status-"));
  const userHome = path.join(tempDir, "home");
  const dispatchHome = path.join(userHome, ".preqstation-dispatch");
  await fs.mkdir(dispatchHome, { recursive: true });
  await fs.writeFile(
    path.join(dispatchHome, "config.json"),
    JSON.stringify({ server_url: "https://preq.example.com" }),
  );
  await fs.writeFile(
    path.join(dispatchHome, "oauth.json"),
    JSON.stringify({ tokens: { access_token: "cached-token" } }),
  );

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["auth", "status"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      HOME: userHome,
      PATH: process.env.PATH,
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    action: "auth_status",
    authenticated: true,
    auth_source: "oauth_cache",
    server_url: "https://preq.example.com",
    home: userHome,
    dispatch_home: dispatchHome,
    config_path: path.join(dispatchHome, "config.json"),
    oauth_path: path.join(dispatchHome, "oauth.json"),
    oauth_cache_exists: true,
  });
});

test("auth status honors PREQSTATION_TOKEN before the OAuth cache", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-auth-status-token-"));
  const userHome = path.join(tempDir, "home");

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["auth", "status"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      HOME: userHome,
      PATH: process.env.PATH,
      PREQSTATION_SERVER_URL: "https://preq.example.com",
      PREQSTATION_TOKEN: "env-token",
    },
  });

  const result = JSON.parse(stdout.join(""));
  assert.equal(exitCode, 0);
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.auth_source, "env_token");
  assert.equal(result.oauth_cache_exists, false);
});

test("auth login persists CLI server URL config and runs OAuth login", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-auth-login-"));
  const dispatchHome = path.join(tempDir, "dispatch");
  const stdout = [];
  const loginCalls = [];

  const exitCode = await runDispatcherCli({
    argv: ["auth", "login", "--server-url", "https://preq.example.com/"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PATH: process.env.PATH,
      PREQSTATION_DISPATCH_HOME: dispatchHome,
    },
    loginPreqstationFn: async (params) => {
      loginCalls.push(params);
      return { tokens: { access_token: "new-token" } };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(loginCalls.length, 1);
  assert.equal(loginCalls[0].serverUrl, "https://preq.example.com");
  assert.equal(loginCalls[0].oauthPath, path.join(dispatchHome, "oauth.json"));
  assert.equal(typeof loginCalls[0].onLoginUrl, "function");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dispatchHome, "config.json"), "utf8")), {
    server_url: "https://preq.example.com",
  });
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    action: "logged_in",
    server_url: "https://preq.example.com",
    home: tempDir,
    dispatch_home: dispatchHome,
    config_path: path.join(dispatchHome, "config.json"),
    oauth_path: path.join(dispatchHome, "oauth.json"),
  });
});

test("auth logout removes OAuth credentials without deleting config or mappings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-auth-logout-"));
  const dispatchHome = path.join(tempDir, "dispatch");
  await fs.mkdir(dispatchHome, { recursive: true });
  await fs.writeFile(path.join(dispatchHome, "oauth.json"), "{}\n");
  await fs.writeFile(path.join(dispatchHome, "config.json"), "{}\n");
  await fs.writeFile(path.join(dispatchHome, "projects.json"), "{}\n");

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["auth", "logout"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PATH: process.env.PATH,
      PREQSTATION_DISPATCH_HOME: dispatchHome,
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    action: "logged_out",
    oauth_path: path.join(dispatchHome, "oauth.json"),
  });
  await assert.rejects(fs.access(path.join(dispatchHome, "oauth.json")));
  await assert.doesNotReject(fs.access(path.join(dispatchHome, "config.json")));
  await assert.doesNotReject(fs.access(path.join(dispatchHome, "projects.json")));
});

test("whoami reports the current server-side identity blocker", async () => {
  const stdout = [];
  const stderr = [];
  const exitCode = await runDispatcherCli({
    argv: ["whoami"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
  });

  assert.equal(exitCode, 1);
  assert.equal(JSON.parse(stdout.join("")).error.code, "auth_identity_unavailable");
  assert.match(stderr.join(""), /auth_identity_unavailable/);
});

test("lifecycle commands call the matching PREQ MCP tools with typed JSON output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-lifecycle-cli-"));
  const notePath = path.join(tempDir, "note.md");
  const completePath = path.join(tempDir, "complete.json");
  const blockPath = path.join(tempDir, "block.md");
  const planPath = path.join(tempDir, "plan.md");
  const reviewPath = path.join(tempDir, "review.json");
  const createPath = path.join(tempDir, "create.json");
  const qaPath = path.join(tempDir, "qa.json");
  const replyPath = path.join(tempDir, "reply.md");
  await fs.writeFile(notePath, "new note\n");
  await fs.writeFile(
    completePath,
    JSON.stringify({ summary: "done", tests: "npm test", prUrl: "https://github.com/o/r/p/1" }),
  );
  await fs.writeFile(blockPath, "blocked reason\n");
  await fs.writeFile(planPath, "plan body\n");
  await fs.writeFile(reviewPath, JSON.stringify({ summary: "verified" }));
  await fs.writeFile(createPath, JSON.stringify({ title: "Task", repo: "https://github.com/o/r" }));
  await fs.writeFile(qaPath, JSON.stringify({ status: "passed", targetUrl: "https://example.com" }));
  await fs.writeFile(replyPath, "reply body\n");

  const cases = [
    {
      argv: ["task", "get", "PROJ-123"],
      toolName: "preq_get_task",
      toolArguments: { taskId: "PROJ-123" },
    },
    {
      argv: ["task", "start", "PROJ-123", "--engine", "codex"],
      toolName: "preq_start_task",
      toolArguments: { taskId: "PROJ-123", engine: "codex" },
    },
    {
      argv: ["task", "note", "PROJ-123", "--body-file", notePath, "--engine", "codex"],
      toolName: "preq_update_task_note",
      toolArguments: { taskId: "PROJ-123", noteMarkdown: "new note\n", engine: "codex" },
    },
    {
      argv: ["task", "status", "PROJ-123", "--status", "ready", "--clear-run-state"],
      toolName: "preq_update_task_status",
      toolArguments: { taskId: "PROJ-123", status: "ready", clearRunState: true },
    },
    {
      argv: ["task", "complete", "PROJ-123", "--json-file", completePath],
      toolName: "preq_complete_task",
      toolArguments: {
        taskId: "PROJ-123",
        summary: "done",
        tests: "npm test",
        prUrl: "https://github.com/o/r/p/1",
      },
    },
    {
      argv: ["task", "block", "PROJ-123", "--reason-file", blockPath],
      toolName: "preq_block_task",
      toolArguments: { taskId: "PROJ-123", reason: "blocked reason\n" },
    },
    {
      argv: ["task", "plan", "PROJ-123", "--plan-file", planPath],
      toolName: "preq_plan_task",
      toolArguments: { taskId: "PROJ-123", projectKey: "PROJ", planMarkdown: "plan body\n" },
    },
    {
      argv: ["task", "review", "PROJ-123", "--json-file", reviewPath, "--engine", "codex"],
      toolName: "preq_review_task",
      toolArguments: { taskId: "PROJ-123", summary: "verified", engine: "codex" },
    },
    {
      argv: ["task", "list", "--project", "PROJ", "--detail", "full", "--limit", "20"],
      toolName: "preq_list_tasks",
      toolArguments: { projectKey: "PROJ", detail: "full", limit: 20 },
    },
    {
      argv: ["task", "create", "--project", "PROJ", "--json-file", createPath],
      toolName: "preq_create_task",
      toolArguments: { projectKey: "PROJ", title: "Task", repo: "https://github.com/o/r" },
    },
    {
      argv: ["task", "delete", "PROJ-123"],
      toolName: "preq_delete_task",
      toolArguments: { taskId: "PROJ-123" },
    },
    {
      argv: ["qa", "update", "--run-id", "RUN-123", "--json-file", qaPath],
      toolName: "preq_update_qa_run",
      toolArguments: { runId: "RUN-123", status: "passed", targetUrl: "https://example.com" },
    },
    {
      argv: ["comment", "list", "--task", "PROJ-123"],
      toolName: "preq_list_task_comments",
      toolArguments: { taskId: "PROJ-123" },
    },
    {
      argv: ["comment", "get", "--comment-id", "COMMENT-123"],
      toolName: "preq_get_task_comment",
      toolArguments: { commentId: "COMMENT-123" },
    },
    {
      argv: ["comment", "reply", "--comment-id", "COMMENT-123", "--body-file", replyPath],
      toolName: "preq_reply_task_comment",
      toolArguments: { commentId: "COMMENT-123", body: "reply body\n" },
    },
    {
      argv: ["comment", "state", "--comment-id", "COMMENT-123", "--state", "done", "--engine", "codex"],
      toolName: "preq_update_task_comment_state",
      toolArguments: { commentId: "COMMENT-123", runState: "done", engine: "codex" },
    },
    {
      argv: ["project", "list"],
      toolName: "preq_list_projects",
      toolArguments: {},
    },
    {
      argv: ["project", "settings", "--project", "PROJ"],
      toolName: "preq_get_project_settings",
      toolArguments: { projectKey: "PROJ" },
    },
    {
      argv: [
        "project",
        "activity",
        "--project",
        "PROJ",
        "--from",
        "2026-01-01T00:00:00.000Z",
        "--to",
        "2026-01-02T00:00:00.000Z",
        "--limit",
        "5",
      ],
      toolName: "preq_list_project_activity",
      toolArguments: {
        projectKeys: ["PROJ"],
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-02T00:00:00.000Z",
        limit: 5,
      },
    },
  ];

  for (const entry of cases) {
    const stdout = [];
    const calls = [];
    const exitCode = await runDispatcherCli({
      argv: entry.argv,
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: () => {} },
      env: {
        PATH: process.env.PATH,
        PREQSTATION_SERVER_URL: "https://preq.example.com",
        PREQSTATION_DISPATCH_HOME: path.join(tempDir, "dispatch"),
      },
      callPreqstationMcpToolFn: async (params) => {
        calls.push(params);
        return { tool: params.toolName };
      },
    });

    assert.equal(exitCode, 0, entry.argv.join(" "));
    assert.equal(calls.length, 1, entry.argv.join(" "));
    assert.equal(calls[0].serverUrl, "https://preq.example.com");
    assert.equal(calls[0].oauthPath, path.join(tempDir, "dispatch", "oauth.json"));
    assert.equal(calls[0].toolName, entry.toolName);
    assert.deepEqual(calls[0].toolArguments, entry.toolArguments);
    assert.deepEqual(JSON.parse(stdout.join("")), {
      ok: true,
      result: { tool: entry.toolName },
    });
  }
});

test("lifecycle command failures use ok false JSON", async () => {
  const stdout = [];
  const stderr = [];
  const exitCode = await runDispatcherCli({
    argv: ["task", "get", "PROJ-123"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
    env: {
      PATH: process.env.PATH,
      PREQSTATION_SERVER_URL: "https://preq.example.com",
    },
    callPreqstationMcpToolFn: async () => {
      throw new Error("server down");
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: false,
    error: {
      code: "preqstation_lifecycle_failed",
      message: "server down",
    },
  });
  assert.match(stderr.join(""), /preqstation_lifecycle_failed/);
});

test("run passes comment-id flag through for comment objectives", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-dispatcher-comment-cli-"));
  const stdout = [];
  const calls = [];
  const exitCode = await runDispatcherCli({
    argv: [
      "run",
      "--project-key",
      "PROJ",
      "--task-key",
      "PROJ-50",
      "--objective",
      "comment",
      "--engine",
      "codex",
      "--comment-id",
      "comment-abc-123",
    ],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: {
      PREQSTATION_PROJECTS_FILE: path.join(tempDir, "projects.json"),
      PREQSTATION_WORKTREE_ROOT: path.join(tempDir, "worktrees"),
    },
    dispatchPreqRun: async (params) => {
      calls.push(params);
      return {
        prepared: { cwd: "/tmp/worktree", branchName: "preqstation/proj/task-proj-50-comment" },
        launch: { pid: 4242, pidFile: "/tmp/worktree/pid", logFile: "/tmp/worktree/log" },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parsed.objective, "comment");
  assert.equal(calls[0].parsed.commentId, "comment-abc-123");
  assert.equal(JSON.parse(stdout.join("")).task_key, "PROJ-50");
});

test("run rejects missing task keys for task objectives before dispatching", async () => {
  const stderr = [];
  const exitCode = await runDispatcherCli({
    argv: ["run", "--project-key", "PROJ", "--objective", "implement", "--engine", "codex"],
    stdout: { write: () => {} },
    stderr: { write: (value) => stderr.push(value) },
    dispatchPreqRun: async () => {
      throw new Error("should not dispatch");
    },
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /Task key is required for implement dispatch/);
});
