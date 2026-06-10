import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { DispatchError } from "./dispatch-error.mjs";

const ENV_FILE_PATTERNS = [/^\.env$/u, /^\.env\.local$/u, /^\.env\..+\.local$/u];
const TEMPLATE_ENV_FILES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function branchExists(projectCwd, branchName) {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
      cwd: projectCwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function remoteExists(projectCwd, remoteName = "origin") {
  try {
    execFileSync("git", ["remote", "get-url", remoteName], {
      cwd: projectCwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function remoteRefExists(projectCwd, remoteRef) {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteRef}`], {
      cwd: projectCwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function resolveWorktreeBaseRef(projectCwd) {
  if (!remoteExists(projectCwd, "origin")) {
    return "HEAD";
  }

  git(["fetch", "origin", "--prune"], projectCwd);

  try {
    const remoteHead = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], projectCwd);
    if (remoteHead.startsWith("refs/remotes/")) {
      return remoteHead.slice("refs/remotes/".length);
    }
  } catch {
    // Fall through to explicit remote refs when origin/HEAD is not configured.
  }

  if (remoteRefExists(projectCwd, "origin/main")) {
    return "origin/main";
  }

  return "HEAD";
}

function shouldCheckRemoteBase(baseRef) {
  return baseRef !== "HEAD";
}

function refContainsBase(projectCwd, baseRef, ref) {
  if (!shouldCheckRemoteBase(baseRef)) {
    return true;
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseRef, ref], {
      cwd: projectCwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function refAheadCount(projectCwd, baseRef, ref) {
  if (!shouldCheckRemoteBase(baseRef)) {
    return 0;
  }

  const count = git(["rev-list", "--count", `${baseRef}..${ref}`], projectCwd);
  return Number.parseInt(count, 10) || 0;
}

function shellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", `'\"'\"'`)}'`;
}

function gitCommand(args) {
  return args.map((arg) => shellArg(arg)).join(" ");
}

function branchCheckoutPath(projectCwd, branchName) {
  const output = git(["worktree", "list", "--porcelain"], projectCwd);
  let currentWorktree = null;

  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      currentWorktree = line.slice("worktree ".length);
      continue;
    }
    if (line === `branch refs/heads/${branchName}`) {
      return currentWorktree;
    }
  }

  return null;
}

function worktreeHead(projectCwd, cwd) {
  return git(["-C", cwd, "rev-parse", "HEAD"], projectCwd);
}

function worktreeContainsBase(projectCwd, baseRef, cwd) {
  if (!shouldCheckRemoteBase(baseRef)) {
    return true;
  }

  return refContainsBase(projectCwd, baseRef, worktreeHead(projectCwd, cwd));
}

function worktreeTrackedStatus(cwd) {
  return git(["-C", cwd, "status", "--porcelain", "--untracked-files=no"], cwd);
}

function staleWorktreeMessage(branchName, baseRef) {
  return [
    `Dispatch branch ${branchName} is stale relative to ${baseRef}.`,
    `Rebase or merge ${baseRef}, remove the stale branch/worktree, or dispatch with a new branch name before creating a PR.`,
  ].join(" ");
}

function createStaleDispatchBranchError({
  projectCwd,
  branchName,
  baseRef,
  worktreePath,
  commands = [],
  suggestedAction,
  ref = branchName,
}) {
  const safeToDelete = refAheadCount(projectCwd, baseRef, ref) === 0;
  return new DispatchError(
    "stale_dispatch_branch",
    staleWorktreeMessage(branchName, baseRef),
    {
      branch_name: branchName,
      base_ref: baseRef,
      worktree_path: worktreePath,
      safe_to_delete: safeToDelete,
      suggested_action: safeToDelete
        ? suggestedAction
        : "rebase_or_merge_branch_and_retry",
      commands: safeToDelete ? commands : [],
    },
  );
}

function createStaleLocalBranchError(projectCwd, baseRef, branchName, cwd) {
  const checkoutPath = branchCheckoutPath(projectCwd, branchName);
  if (checkoutPath) {
    return createStaleDispatchBranchError({
      projectCwd,
      branchName,
      baseRef,
      worktreePath: checkoutPath,
      suggestedAction: "checkout_different_ref_delete_branch_and_retry",
      commands: [
        gitCommand(["git", "-C", checkoutPath, "switch", "--detach", baseRef]),
        gitCommand(["git", "-C", projectCwd, "branch", "-D", branchName]),
      ],
    });
  }

  return createStaleDispatchBranchError({
    projectCwd,
    branchName,
    baseRef,
    worktreePath: cwd,
    suggestedAction: "delete_branch_and_retry",
    commands: [gitCommand(["git", "-C", projectCwd, "branch", "-D", branchName])],
  });
}

function createStaleReusableWorktreeError(projectCwd, baseRef, branchName, cwd) {
  return createStaleDispatchBranchError({
    projectCwd,
    branchName,
    baseRef,
    worktreePath: cwd,
    ref: branchExists(projectCwd, branchName) ? branchName : worktreeHead(projectCwd, cwd),
    suggestedAction: "remove_worktree_delete_branch_and_retry",
    commands: [
      gitCommand(["git", "-C", projectCwd, "worktree", "remove", cwd, "--force"]),
      gitCommand(["git", "-C", projectCwd, "worktree", "prune"]),
      gitCommand(["git", "-C", projectCwd, "branch", "-D", branchName]),
    ],
  });
}

function dirtyWorktreeMessage(cwd) {
  return [
    `Dispatch worktree ${cwd} has tracked local changes.`,
    "Remove or clean the existing dispatch worktree, or dispatch with a new branch name before retrying.",
  ].join(" ");
}

function createDirtyDispatchWorktreeError(cwd) {
  return new DispatchError(
    "dirty_dispatch_worktree",
    dirtyWorktreeMessage(cwd),
    {
      worktree_path: cwd,
      suggested_action: "inspect_or_clean_worktree_and_retry",
      commands: [gitCommand(["git", "-C", cwd, "status", "--short"])],
    },
  );
}

function isReusableWorktree(cwd) {
  return fs
    .access(path.join(cwd, ".git"))
    .then(() => true)
    .catch(() => false);
}

export async function ensureProjectCheckout(projectCwd) {
  const stat = await fs.stat(projectCwd).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new DispatchError(
      "project_path_missing",
      `Project path does not exist: ${projectCwd}`,
      {
        project_path: projectCwd,
        suggested_action: "update_project_mapping_and_retry",
      },
    );
  }

  const gitDir = path.join(projectCwd, ".git");
  const gitStat = await fs.lstat(gitDir).catch(() => null);
  if (!gitStat) {
    throw new DispatchError(
      "project_not_git_checkout",
      `Project path is not a git checkout: ${projectCwd}`,
      {
        project_path: projectCwd,
        suggested_action: "map_project_to_git_checkout_and_retry",
      },
    );
  }
}

async function symlinkRuntimeEnvFiles(projectCwd, cwd) {
  const entries = await fs.readdir(projectCwd);
  for (const name of entries) {
    if (TEMPLATE_ENV_FILES.has(name)) {
      continue;
    }
    if (!ENV_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
      continue;
    }

    const source = path.join(projectCwd, name);
    const target = path.join(cwd, name);
    const sourceStat = await fs.lstat(source).catch(() => null);
    if (!sourceStat?.isFile()) {
      continue;
    }

    const targetStat = await fs.lstat(target).catch(() => null);
    if (targetStat && !targetStat.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite existing regular file: ${target}`);
    }
    if (targetStat?.isSymbolicLink()) {
      await fs.rm(target);
    }

    await fs.symlink(source, target);
  }
}

export function normalizeBranchName({ projectKey, taskKey, branchName, objective }) {
  if (branchName) {
    return branchName;
  }

  const normalizedProjectKey = projectKey.toLowerCase();
  if (!taskKey) {
    if (!objective) {
      const fallbackTaskKey = `${projectKey}-dispatch`
        .toLowerCase()
        .replace(/[^a-z0-9-]+/gu, "-");
      return `preqstation/${normalizedProjectKey}/task-${fallbackTaskKey}`;
    }

    const normalizedObjective = objective
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-");
    return `preqstation/${normalizedProjectKey}/${normalizedObjective}`;
  }

  const normalizedTaskKey = taskKey.toLowerCase().replace(/[^a-z0-9-]+/gu, "-");
  return `preqstation/${normalizedProjectKey}/task-${normalizedTaskKey}`;
}

export async function prepareWorktree({
  projectCwd,
  projectKey,
  taskKey = null,
  objective = null,
  branchName,
  worktreeRoot,
}) {
  await ensureProjectCheckout(projectCwd);

  const resolvedBranchName = normalizeBranchName({
    projectKey,
    taskKey,
    objective,
    branchName,
  });
  const branchSlug = resolvedBranchName.replaceAll("/", "-");
  const cwd = path.join(worktreeRoot, projectKey, branchSlug);
  const baseRef = resolveWorktreeBaseRef(projectCwd);

  await fs.mkdir(path.dirname(cwd), { recursive: true });

  if (await isReusableWorktree(cwd)) {
    if (!worktreeContainsBase(projectCwd, baseRef, cwd)) {
      throw createStaleReusableWorktreeError(projectCwd, baseRef, resolvedBranchName, cwd);
    }
    if (worktreeTrackedStatus(cwd)) {
      throw createDirtyDispatchWorktreeError(cwd);
    }
  } else {
    if (branchExists(projectCwd, resolvedBranchName)) {
      if (!refContainsBase(projectCwd, baseRef, resolvedBranchName)) {
        throw createStaleLocalBranchError(projectCwd, baseRef, resolvedBranchName, cwd);
      }
      git(["worktree", "add", "--detach", cwd, resolvedBranchName], projectCwd);
    } else {
      git(
        ["worktree", "add", "-b", resolvedBranchName, cwd, baseRef],
        projectCwd,
      );
    }
  }

  await symlinkRuntimeEnvFiles(projectCwd, cwd);

  return {
    cwd,
    branchName: resolvedBranchName,
  };
}
