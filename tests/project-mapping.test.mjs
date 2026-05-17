import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadDispatchProjectMappings,
  loadProjectMappings,
  matchProjectsToRepoRoots,
  resolveProjectCwd,
  resolveProjectCwdWithSources,
} from "../src/project-mapping.mjs";

test("loads project mappings from MEMORY markdown table", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-memory-"),
  );
  const memoryPath = path.join(tempDir, "MEMORY.md");

  await fs.writeFile(
    memoryPath,
    [
      "# MEMORY",
      "",
      "| key  | cwd                | note |",
      "| ---- | ------------------ | ---- |",
      "| PROJ | /tmp/example-proj | App  |",
      "| DOCS | TBD                | Docs |",
      "",
    ].join("\n"),
  );

  const mappings = await loadProjectMappings(memoryPath);

  assert.deepEqual(mappings, {
    PROJ: "/tmp/example-proj",
  });
});

test("resolves explicit absolute path before mapping lookup", async () => {
  const cwd = await resolveProjectCwd({
    rawMessage: "preqstation implement PROJ-12 in /tmp/direct-project with codex",
    projectKey: "PROJ",
    memoryPath: "/does/not/matter",
  });

  assert.equal(cwd, "/tmp/direct-project");
});

test("does not treat slash commands in ask text as explicit project paths", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-ask-slash-command-"),
  );
  const sharedMappingPath = path.join(tempDir, "projects.json");

  await fs.writeFile(
    sharedMappingPath,
    JSON.stringify(
      {
        projects: {
          PROJ: "/Users/example/projects/projects-manager",
        },
      },
      null,
      2,
    ),
  );

  const cwd = await resolveProjectCwdWithSources({
    rawMessage: "Ask: run /audit for connections page",
    projectKey: "PROJ",
    configuredProjects: {},
    sharedMappingPath,
    memoryPath: "/does/not/matter",
  });

  assert.equal(cwd, "/Users/example/projects/projects-manager");
});

test("loads shared PREQ dispatch mappings from projects.json", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-projects-json-"),
  );
  const mappingPath = path.join(tempDir, "projects.json");

  await fs.writeFile(
    mappingPath,
    JSON.stringify(
      {
        projects: {
          PROJ: "/Users/example/projects/projects-manager",
          docs: "relative/path",
        },
      },
      null,
      2,
    ),
  );

  const mappings = await loadDispatchProjectMappings(mappingPath);

  assert.deepEqual(mappings, {
    PROJ: "/Users/example/projects/projects-manager",
  });
});

test("matches GitLab SSH remotes to HTTPS project URLs", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-gitlab-ssh-"),
  );
  const projectPath = path.join(tempDir, "group", "repo");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@gitlab.com:group/repo.git"],
    { cwd: projectPath, stdio: "ignore" },
  );

  const discovered = await matchProjectsToRepoRoots(
    [{ projectKey: "GL", repoUrl: "https://gitlab.com/group/repo" }],
    tempDir,
  );

  assert.deepEqual(discovered.matched, {
    GL: projectPath,
  });
});

test("shared PREQ dispatch mappings are used before MEMORY fallback", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-shared-resolve-"),
  );
  const sharedMappingPath = path.join(tempDir, "projects.json");
  const memoryPath = path.join(tempDir, "MEMORY.md");

  await fs.writeFile(
    sharedMappingPath,
    JSON.stringify(
      {
        projects: {
          PROJ: "/Users/example/projects/projects-manager",
        },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    memoryPath,
    [
      "# MEMORY",
      "",
      "| key  | cwd                    | note |",
      "| ---- | ---------------------- | ---- |",
      "| PROJ | /tmp/fallback-project | App  |",
      "",
    ].join("\n"),
  );

  const cwd = await resolveProjectCwdWithSources({
    rawMessage: "preqstation plan PROJ-12 using codex",
    projectKey: "PROJ",
    configuredProjects: {},
    sharedMappingPath,
    memoryPath,
  });

  assert.equal(cwd, "/Users/example/projects/projects-manager");
});

test("fails clearly when no mapping source is configured", async () => {
  await assert.rejects(
    resolveProjectCwdWithSources({
      rawMessage: "preqstation implement PROJ-123 using codex",
      projectKey: "PROJ",
      configuredProjects: null,
      sharedMappingPath: "/tmp/preqstation-dispatcher/missing-projects.json",
      memoryPath: null,
    }),
    /No project path mapping found for PROJ/,
  );
});
