import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const TABLE_ROW_PATTERN =
  /^\|\s*([A-Za-z0-9_-]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/u;
const EXPLICIT_PATH_PATTERNS = [
  /\bin\s+(\/[^\s"']+)/u,
  /\bcwd=(\/[^\s"']+)/u,
  /\bpath=(\/[^\s"']+)/u,
];

function resolveOsUserHome() {
  try {
    const userHome = os.userInfo().homedir;
    if (typeof userHome === "string" && userHome.trim()) {
      return userHome.trim();
    }
  } catch {}

  return os.homedir();
}

function extractHermesUserHome(candidatePath) {
  const value = typeof candidatePath === "string" ? candidatePath.trim() : "";
  if (!value) {
    return null;
  }

  const normalized = path.resolve(value);
  const profileMarker = `${path.sep}.hermes${path.sep}profiles${path.sep}`;
  const profileIndex = normalized.indexOf(profileMarker);
  if (profileIndex > 0) {
    return normalized.slice(0, profileIndex);
  }

  if (normalized.endsWith(`${path.sep}.hermes`)) {
    return path.dirname(normalized);
  }

  return null;
}

// Hermes profile subprocesses override HOME to ~/.hermes/profiles/<name>/home.
// Use the owning user's home for dispatcher defaults so setup/run share one mapping file.
export function resolveDefaultUserHome(env = process.env) {
  return (
    extractHermesUserHome(env?.HERMES_HOME) ??
    extractHermesUserHome(env?.HOME) ??
    resolveOsUserHome()
  );
}

export function getDefaultRepoRoots(env = process.env) {
  return [path.join(resolveDefaultUserHome(env), "projects")];
}

export function getDefaultSharedMappingPath(env = process.env) {
  return path.join(resolveDefaultUserHome(env), ".preqstation", "projects.json");
}

export const DEFAULT_REPO_ROOTS = getDefaultRepoRoots();
export const DEFAULT_SHARED_MAPPING_PATH = getDefaultSharedMappingPath();

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractExplicitProjectPath(rawMessage) {
  const message = normalizeString(rawMessage);
  if (!message) {
    return null;
  }

  for (const pattern of EXPLICIT_PATH_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export function normalizeRepoUrl(repoUrl) {
  const value = normalizeString(repoUrl);
  if (!value) {
    return "";
  }

  return value
    .replace(/^git@github\.com:/iu, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//iu, "https://github.com/")
    .replace(/^git@gitlab\.com:/iu, "https://gitlab.com/")
    .replace(/^ssh:\/\/git@gitlab\.com\//iu, "https://gitlab.com/")
    .replace(/\.git$/iu, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

export function readRepoRoots(raw) {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
      .map((entry) => path.resolve(entry));
  }

  const normalized = normalizeString(raw);
  if (!normalized) {
    return DEFAULT_REPO_ROOTS;
  }

  return normalized
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepo(dirPath) {
  return pathExists(path.join(dirPath, ".git"));
}

async function walkRepoCandidates(rootPath, depth = 0, maxDepth = 2) {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  if (await isGitRepo(rootPath)) {
    return [rootPath];
  }

  if (depth >= maxDepth) {
    return [];
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    candidates.push(
      ...(await walkRepoCandidates(path.join(rootPath, entry.name), depth + 1, maxDepth)),
    );
  }

  return candidates;
}

async function buildRepoIndex(repoRoots) {
  const index = new Map();

  for (const rootPath of readRepoRoots(repoRoots)) {
    const candidates = await walkRepoCandidates(rootPath);
    for (const candidate of candidates) {
      try {
        const originUrl = git(["remote", "get-url", "origin"], candidate);
        const normalized = normalizeRepoUrl(originUrl);
        if (normalized && !index.has(normalized)) {
          index.set(normalized, candidate);
        }
      } catch {}
    }
  }

  return index;
}

export async function matchProjectsToRepoRoots(projects, repoRoots = DEFAULT_REPO_ROOTS) {
  const index = await buildRepoIndex(repoRoots);
  const matched = {};
  const unmatched = [];

  for (const project of projects) {
    const projectKey = normalizeString(project?.projectKey).toUpperCase();
    const repoUrl = normalizeRepoUrl(project?.repoUrl);
    if (!projectKey || !repoUrl) {
      unmatched.push({
        projectKey,
        repoUrl: normalizeString(project?.repoUrl),
      });
      continue;
    }

    const projectCwd = index.get(repoUrl);
    if (!projectCwd) {
      unmatched.push({ projectKey, repoUrl });
      continue;
    }

    matched[projectKey] = projectCwd;
  }

  return { matched, unmatched, repoRoots: readRepoRoots(repoRoots) };
}

export async function loadProjectMappings(memoryPath) {
  const content = await fs.readFile(memoryPath, "utf8");
  const mappings = {};

  for (const line of content.split("\n")) {
    const match = line.match(TABLE_ROW_PATTERN);
    if (!match) {
      continue;
    }

    const [, key, cwd] = match;
    const trimmedCwd = cwd.trim();
    if (!trimmedCwd.startsWith("/") || trimmedCwd === "TBD") {
      continue;
    }

    mappings[key.toUpperCase()] = trimmedCwd;
  }

  return mappings;
}

export async function loadDispatchProjectMappings(
  mappingPath = DEFAULT_SHARED_MAPPING_PATH,
) {
  let content;
  try {
    content = await fs.readFile(mappingPath, "utf8");
  } catch (error) {
    const legacyMappingPath = mappingPath.replace(
      `${path.sep}.preqstation${path.sep}projects.json`,
      `${path.sep}.preqstation-dispatch${path.sep}projects.json`,
    );
    if (error?.code !== "ENOENT" || legacyMappingPath === mappingPath) {
      throw error;
    }
    content = await fs.readFile(legacyMappingPath, "utf8");
  }
  const parsed = JSON.parse(content);
  const mappings = {};

  for (const [key, cwd] of Object.entries(parsed?.projects ?? {})) {
    const trimmedCwd = typeof cwd === "string" ? cwd.trim() : "";
    if (!trimmedCwd.startsWith("/")) {
      continue;
    }
    mappings[key.toUpperCase()] = trimmedCwd;
  }

  return mappings;
}

export async function resolveProjectCwd({ rawMessage, projectKey, memoryPath }) {
  const explicitPath = extractExplicitProjectPath(rawMessage);
  if (explicitPath) {
    return explicitPath;
  }

  if (!memoryPath) {
    throw new Error(`No project path mapping found for ${projectKey}`);
  }

  const mappings = await loadProjectMappings(memoryPath);
  const mapped = mappings[projectKey.toUpperCase()];
  if (!mapped) {
    throw new Error(`No project path mapping found for ${projectKey}`);
  }

  return mapped;
}

export async function resolveProjectCwdWithSources({
  rawMessage,
  projectKey,
  configuredProjects,
  sharedMappingPath = DEFAULT_SHARED_MAPPING_PATH,
  memoryPath,
}) {
  const explicitPath = extractExplicitProjectPath(rawMessage);
  if (explicitPath) {
    return explicitPath;
  }

  const configured = configuredProjects?.[projectKey.toUpperCase()];
  if (configured) {
    return configured;
  }

  const sharedMappings = await loadDispatchProjectMappings(sharedMappingPath).catch(
    (error) => {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    },
  );
  const shared = sharedMappings?.[projectKey.toUpperCase()];
  if (shared) {
    return shared;
  }

  return resolveProjectCwd({ rawMessage, projectKey, memoryPath });
}
