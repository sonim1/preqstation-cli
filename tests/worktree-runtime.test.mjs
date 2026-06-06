import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  normalizeBranchName,
  prepareWorktree,
} from "../src/worktree-runtime.mjs";

function git(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

async function createRepo() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-repo-"),
  );
  git(["init", "-b", "main"], tempDir);
  git(["config", "user.name", "Codex"], tempDir);
  git(["config", "user.email", "codex@example.com"], tempDir);
  await fs.writeFile(path.join(tempDir, "README.md"), "# repo\n");
  git(["add", "."], tempDir);
  git(["commit", "-m", "init"], tempDir);
  await fs.writeFile(path.join(tempDir, ".env.local"), "HELLO=world\n");
  return tempDir;
}

async function createRemoteBackedRepo() {
  const seedDir = await createRepo();
  const remoteDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-remote-"),
  );
  const cloneDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-clone-"),
  );

  git(["init", "--bare"], remoteDir);
  git(["remote", "add", "origin", remoteDir], seedDir);
  git(["push", "-u", "origin", "main"], seedDir);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], remoteDir);
  execFileSync("git", ["clone", remoteDir, cloneDir], { stdio: "pipe" });

  return { seedDir, remoteDir, cloneDir };
}

test("normalizes missing branch names to a project-scoped task branch", () => {
  assert.equal(
    normalizeBranchName({ projectKey: "PROJ", taskKey: "PROJ-327", branchName: null }),
    "preqstation/proj/task-proj-327",
  );
});

test("normalizes project-level dispatches without a task key", () => {
  assert.equal(
    normalizeBranchName({
      projectKey: "PROJ",
      taskKey: null,
      branchName: null,
      objective: "insight",
    }),
    "preqstation/proj/insight",
  );
});

test("creates an auxiliary worktree and symlinks runtime env files", async () => {
  const repoDir = await createRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  const prepared = await prepareWorktree({
    projectCwd: repoDir,
    projectKey: "PROJ",
    branchName: "task/proj-327/browser-notification-chuga",
    worktreeRoot,
  });

  assert.notEqual(prepared.cwd, repoDir);
  assert.equal(
    prepared.cwd,
    path.join(
      worktreeRoot,
      "PROJ",
      "task-proj-327-browser-notification-chuga",
    ),
  );

  const envStat = await fs.lstat(path.join(prepared.cwd, ".env.local"));
  assert.equal(envStat.isSymbolicLink(), true);
  assert.equal(
    await fs.readlink(path.join(prepared.cwd, ".env.local")),
    path.join(repoDir, ".env.local"),
  );
});

test("creates a new worktree branch from the fetched origin main state", async () => {
  const { seedDir, cloneDir } = await createRemoteBackedRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  await fs.writeFile(path.join(seedDir, "fresh.txt"), "fresh\n");
  git(["add", "fresh.txt"], seedDir);
  git(["commit", "-m", "fresh"], seedDir);
  git(["push", "origin", "main"], seedDir);

  const localHeadBefore = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: cloneDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  const prepared = await prepareWorktree({
    projectCwd: cloneDir,
    projectKey: "PROJ",
    branchName: "task/proj-remote-base",
    worktreeRoot,
  });

  const worktreeHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: prepared.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  assert.notEqual(worktreeHead, localHeadBefore);
  assert.equal(await fs.readFile(path.join(prepared.cwd, "fresh.txt"), "utf8"), "fresh\n");
});

test("rejects an existing local dispatch branch that is stale relative to origin main", async () => {
  const { seedDir, cloneDir } = await createRemoteBackedRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  git(["checkout", "-b", "task/proj-stale-existing"], cloneDir);

  await fs.writeFile(path.join(seedDir, "fresh.txt"), "fresh\n");
  git(["add", "fresh.txt"], seedDir);
  git(["commit", "-m", "fresh"], seedDir);
  git(["push", "origin", "main"], seedDir);

  await assert.rejects(
    prepareWorktree({
      projectCwd: cloneDir,
      projectKey: "PROJ",
      branchName: "task/proj-stale-existing",
      worktreeRoot,
    }),
    /stale relative to origin\/main/,
  );
});

test("rejects a reusable worktree that is stale relative to origin main", async () => {
  const { seedDir, cloneDir } = await createRemoteBackedRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  const first = await prepareWorktree({
    projectCwd: cloneDir,
    projectKey: "PROJ",
    branchName: "task/proj-stale-reuse",
    worktreeRoot,
  });

  await fs.writeFile(path.join(seedDir, "fresh.txt"), "fresh\n");
  git(["add", "fresh.txt"], seedDir);
  git(["commit", "-m", "fresh"], seedDir);
  git(["push", "origin", "main"], seedDir);

  await assert.rejects(
    prepareWorktree({
      projectCwd: cloneDir,
      projectKey: "PROJ",
      branchName: "task/proj-stale-reuse",
      worktreeRoot,
    }),
    /stale relative to origin\/main/,
  );

  assert.equal(await fs.stat(first.cwd).then((stat) => stat.isDirectory()), true);
});

test("rejects a reusable worktree with tracked local changes", async () => {
  const repoDir = await createRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  const first = await prepareWorktree({
    projectCwd: repoDir,
    projectKey: "PROJ",
    branchName: "task/proj-dirty-reuse",
    worktreeRoot,
  });

  await fs.writeFile(path.join(first.cwd, "README.md"), "# changed\n");

  await assert.rejects(
    prepareWorktree({
      projectCwd: repoDir,
      projectKey: "PROJ",
      branchName: "task/proj-dirty-reuse",
      worktreeRoot,
    }),
    /tracked local changes/,
  );
});

test("fails with a clear error when the mapped project path does not exist", async () => {
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  await assert.rejects(
    prepareWorktree({
      projectCwd: "/tmp/preqstation-dispatcher/does-not-exist",
      projectKey: "PROJ",
      branchName: "task/proj-328/edit-task-isyu",
      worktreeRoot,
    }),
    /Project path does not exist: \/tmp\/preqstation-dispatcher\/does-not-exist/,
  );
});

test("creates a project-level worktree when task key is absent", async () => {
  const repoDir = await createRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  const prepared = await prepareWorktree({
    projectCwd: repoDir,
    projectKey: "PROJ",
    taskKey: null,
    objective: "insight",
    worktreeRoot,
  });

  assert.equal(prepared.branchName, "preqstation/proj/insight");
  assert.equal(
    prepared.cwd,
    path.join(worktreeRoot, "PROJ", "preqstation-proj-insight"),
  );
});
