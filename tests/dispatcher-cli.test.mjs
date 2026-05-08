import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDispatcherCli } from "../src/cli/preqstation-dispatcher.mjs";

const packageJsonPath = new URL("../package.json", import.meta.url);

async function readCurrentPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  return pkg.version;
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
  assert.match(help, /preqstation setup auto\s*$/m);
  assert.match(help, /preqstation install hermes/);
  assert.match(help, /preqstation sync hermes/);
  assert.match(help, /preqstation run --project-key PROJ/);
  assert.doesNotMatch(help, /^Usage:/m);
  assert.doesNotMatch(help, /preqstation-dispatcher run/);
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
