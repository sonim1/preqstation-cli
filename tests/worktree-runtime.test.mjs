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

test("rejects a safe stale local dispatch branch with structured recovery details", async () => {
  const { seedDir, cloneDir } = await createRemoteBackedRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  git(["branch", "task/proj-stale-existing"], cloneDir);

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
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "stale_dispatch_branch");
      assert.equal(error.branch_name, "task/proj-stale-existing");
      assert.equal(error.base_ref, "origin/main");
      assert.equal(
        error.worktree_path,
        path.join(worktreeRoot, "PROJ", "task-proj-stale-existing"),
      );
      assert.equal(error.safe_to_delete, true);
      assert.equal(error.suggested_action, "delete_branch_and_retry");
      assert.deepEqual(error.commands, [
        `git -C ${cloneDir} branch -D task/proj-stale-existing`,
      ]);
      return true;
    },
  );
});

test("rejects an existing local dispatch branch with unique commits when stale relative to origin main", async () => {
  const { seedDir, cloneDir } = await createRemoteBackedRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  git(["checkout", "-b", "task/proj-stale-with-work"], cloneDir);
  git(["config", "user.name", "Codex"], cloneDir);
  git(["config", "user.email", "codex@example.com"], cloneDir);
  await fs.writeFile(path.join(cloneDir, "work.txt"), "work\n");
  git(["add", "work.txt"], cloneDir);
  git(["commit", "-m", "work"], cloneDir);
  git(["checkout", "main"], cloneDir);

  await fs.writeFile(path.join(seedDir, "fresh.txt"), "fresh\n");
  git(["add", "fresh.txt"], seedDir);
  git(["commit", "-m", "fresh"], seedDir);
  git(["push", "origin", "main"], seedDir);

  await assert.rejects(
    prepareWorktree({
      projectCwd: cloneDir,
      projectKey: "PROJ",
      branchName: "task/proj-stale-with-work",
      worktreeRoot,
    }),
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "stale_dispatch_branch");
      assert.equal(error.safe_to_delete, false);
      assert.equal(error.suggested_action, "rebase_or_merge_branch_and_retry");
      assert.deepEqual(error.commands, []);
      return true;
    },
  );
});

test("rejects an existing checked-out dispatch branch when stale relative to origin main", async () => {
  const { seedDir, cloneDir } = await createRemoteBackedRepo();
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  git(["checkout", "-b", "task/proj-stale-checked-out"], cloneDir);

  await fs.writeFile(path.join(seedDir, "fresh.txt"), "fresh\n");
  git(["add", "fresh.txt"], seedDir);
  git(["commit", "-m", "fresh"], seedDir);
  git(["push", "origin", "main"], seedDir);

  await assert.rejects(
    prepareWorktree({
      projectCwd: cloneDir,
      projectKey: "PROJ",
      branchName: "task/proj-stale-checked-out",
      worktreeRoot,
    }),
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "stale_dispatch_branch");
      assert.equal(error.safe_to_delete, true);
      assert.equal(
        error.suggested_action,
        "checkout_different_ref_delete_branch_and_retry",
      );
      assert.equal(error.commands.length, 2);
      assert.match(error.commands[0], /git -C .* switch --detach origin\/main/u);
      assert.equal(
        error.commands[1],
        `git -C ${cloneDir} branch -D task/proj-stale-checked-out`,
      );
      return true;
    },
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
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "stale_dispatch_branch");
      assert.equal(error.safe_to_delete, true);
      assert.equal(
        error.suggested_action,
        "remove_worktree_delete_branch_and_retry",
      );
      assert.deepEqual(error.commands, [
        `git -C ${cloneDir} worktree remove ${first.cwd} --force`,
        `git -C ${cloneDir} worktree prune`,
        `git -C ${cloneDir} branch -D task/proj-stale-reuse`,
      ]);
      return true;
    },
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
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "dirty_dispatch_worktree");
      assert.equal(error.worktree_path, first.cwd);
      assert.deepEqual(error.commands, [`git -C ${first.cwd} status --short`]);
      return true;
    },
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
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "project_path_missing");
      assert.equal(error.project_path, "/tmp/preqstation-dispatcher/does-not-exist");
      assert.match(error.message, /Project path does not exist/);
      return true;
    },
  );
});

test("fails with a typed error when the mapped project path is not a git checkout", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-not-git-"),
  );
  const worktreeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-worktrees-"),
  );

  await assert.rejects(
    prepareWorktree({
      projectCwd: tempDir,
      projectKey: "PROJ",
      branchName: "task/proj-328/edit-task-isyu",
      worktreeRoot,
    }),
    (error) => {
      assert.equal(error.name, "DispatchError");
      assert.equal(error.code, "project_not_git_checkout");
      assert.equal(error.project_path, tempDir);
      assert.match(error.message, /Project path is not a git checkout/);
      return true;
    },
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
