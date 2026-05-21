import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  createSetupCommandHandler,
  parseSetupArgs,
} from "../src/setup-command.mjs";

test("parses setup command arguments", () => {
  assert.deepEqual(
    parseSetupArgs("set PROJ /Users/example/projects/projects-manager"),
    {
      action: "set",
      projectKey: "PROJ",
      projectCwd: "/Users/example/projects/projects-manager",
    },
  );
});

test("parses setup import arguments", () => {
  assert.deepEqual(parseSetupArgs("import"), {
    action: "import",
    projectKey: null,
    projectCwd: null,
  });
});

test("parses setup auto arguments", () => {
  assert.deepEqual(
    parseSetupArgs("auto\nPROJ https://github.com/sonim1/projects-manager"),
    {
      action: "auto",
      projectKey: null,
      projectCwd: null,
      payload: "PROJ https://github.com/sonim1/projects-manager",
    },
  );
});

test("setup command auto-maps projects from single-line key=url payload", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-auto-inline-"),
  );
  const repoRoot = path.join(tempDir, "projects");
  const matchedRepo = path.join(repoRoot, "projects-manager");
  let writtenConfig = null;

  await fs.mkdir(matchedRepo, { recursive: true });
  execFileSync("git", ["init"], { cwd: matchedRepo, stdio: "ignore" });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:sonim1/projects-manager.git"],
    { cwd: matchedRepo, stdio: "ignore" },
  );

  const api = {
    runtime: {
      config: {
        loadConfig() {
          return {
            plugins: {
              entries: {
                "preqstation-dispatcher": {
                  enabled: true,
                  config: {},
                },
              },
            },
          };
        },
        async writeConfigFile(nextConfig) {
          writtenConfig = nextConfig;
        },
      },
    },
  };

  const handler = createSetupCommandHandler(api, { repoRoots: [repoRoot] });
  const result = await handler({
    channel: "telegram",
    isAuthorizedSender: true,
    commandBody:
      "/preqstation setup auto PROJ=https://github.com/sonim1/projects-manager MISS=https://github.com/sonim1/missing-repo",
    args: "auto PROJ=https://github.com/sonim1/projects-manager MISS=https://github.com/sonim1/missing-repo",
    config: {},
  });

  assert.match(result.text, /Matched 1 PREQ project mapping/);
  assert.match(result.text, /MISS -> https:\/\/github.com\/sonim1\/missing-repo/);
  assert.equal(
    writtenConfig.plugins.entries["preqstation-dispatcher"].config.projects.PROJ,
    matchedRepo,
  );
});

test("setup command writes project mapping into plugin config", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-set-"),
  );
  const repoDir = path.join(tempDir, "projects-manager");
  let writtenConfig = null;

  await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });

  const api = {
    runtime: {
      config: {
        loadConfig() {
          return {
            plugins: {
              entries: {
                "preqstation-dispatcher": {
                  enabled: true,
                  config: {
                    worktreeRoot: "/tmp/openclaw-worktrees",
                  },
                },
              },
            },
          };
        },
        async writeConfigFile(nextConfig) {
          writtenConfig = nextConfig;
        },
      },
    },
  };

  const handler = createSetupCommandHandler(api);
  const result = await handler({
    channel: "telegram",
    isAuthorizedSender: true,
    commandBody: `/preqstation setup set PROJ ${repoDir}`,
    args: `set PROJ ${repoDir}`,
    config: {},
  });

  assert.match(result.text, /Saved PREQ project mapping/);
  assert.equal(
    writtenConfig.plugins.entries["preqstation-dispatcher"].config.projects.PROJ,
    repoDir,
  );
  assert.equal(
    writtenConfig.plugins.entries["preqstation-dispatcher"].config.worktreeRoot,
    "/tmp/openclaw-worktrees",
  );
});

test("setup command shows current mappings when called without args", async () => {
  const api = {
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
  };

  const handler = createSetupCommandHandler(api);
  const result = await handler({
    channel: "telegram",
    isAuthorizedSender: true,
    commandBody: "/preqstation setup",
    args: "",
    config: {},
  });

  assert.match(result.text, /Usage: \/preqstation setup set <PROJECT_KEY> <ABSOLUTE_PATH>/);
  assert.match(result.text, /PROJ -> \/Users\/example\/projects\/projects-manager/);
});

test("setup command rejects missing project paths before saving", async () => {
  let writeCount = 0;
  const api = {
    runtime: {
      config: {
        loadConfig() {
          return {
            plugins: {
              entries: {
                "preqstation-dispatcher": {
                  enabled: true,
                  config: {},
                },
              },
            },
          };
        },
        async writeConfigFile() {
          writeCount += 1;
        },
      },
    },
  };

  const handler = createSetupCommandHandler(api);
  await assert.rejects(
    handler({
      channel: "telegram",
      isAuthorizedSender: true,
      commandBody: "/preqstation setup set PROJ /tmp/preqstation-dispatcher/does-not-exist",
      args: "set PROJ /tmp/preqstation-dispatcher/does-not-exist",
      config: {},
    }),
    /Project path does not exist: \/tmp\/preqstation-dispatcher\/does-not-exist/,
  );
  assert.equal(writeCount, 0);
});

test("setup command imports shared PREQ mappings in one shot", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-import-"),
  );
  const repoDir = path.join(tempDir, "projects-manager");
  const sharedMappingPath = path.join(tempDir, "projects.json");
  let writtenConfig = null;

  await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
  await fs.writeFile(
    sharedMappingPath,
    JSON.stringify(
      {
        projects: {
          PROJ: repoDir,
          PERS: "/tmp/preqstation-dispatcher/does-not-exist",
        },
      },
      null,
      2,
    ),
  );

  const api = {
    runtime: {
      config: {
        loadConfig() {
          return {
            plugins: {
              entries: {
                "preqstation-dispatcher": {
                  enabled: true,
                  config: {},
                },
              },
            },
          };
        },
        async writeConfigFile(nextConfig) {
          writtenConfig = nextConfig;
        },
      },
    },
  };

  const handler = createSetupCommandHandler(api, { sharedMappingPath });
  const result = await handler({
    channel: "telegram",
    isAuthorizedSender: true,
    commandBody: "/preqstation setup import",
    args: "import",
    config: {},
  });

  assert.match(result.text, /Imported 1 PREQ project mapping/);
  assert.match(result.text, /Skipped invalid shared mappings:/);
  assert.equal(
    writtenConfig.plugins.entries["preqstation-dispatcher"].config.projects.PROJ,
    repoDir,
  );
  assert.equal(
    writtenConfig.plugins.entries["preqstation-dispatcher"].config.projects.PERS,
    undefined,
  );
});

test("setup command auto-maps projects by repo URL under repo roots", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "preqstation-dispatcher-auto-"),
  );
  const repoRoot = path.join(tempDir, "projects");
  const matchedRepo = path.join(repoRoot, "projects-manager");
  const unmatchedRepoUrl = "https://github.com/sonim1/missing-repo";
  let writtenConfig = null;

  await fs.mkdir(matchedRepo, { recursive: true });
  execFileSync("git", ["init"], { cwd: matchedRepo, stdio: "ignore" });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:sonim1/projects-manager.git"],
    { cwd: matchedRepo, stdio: "ignore" },
  );

  const api = {
    runtime: {
      config: {
        loadConfig() {
          return {
            plugins: {
              entries: {
                "preqstation-dispatcher": {
                  enabled: true,
                  config: {},
                },
              },
            },
          };
        },
        async writeConfigFile(nextConfig) {
          writtenConfig = nextConfig;
        },
      },
    },
  };

  const handler = createSetupCommandHandler(api, { repoRoots: [repoRoot] });
  const result = await handler({
    channel: "telegram",
    isAuthorizedSender: true,
    commandBody: "/preqstation setup auto",
    args: [
      "auto",
      "PROJ https://github.com/sonim1/projects-manager",
      `MISS ${unmatchedRepoUrl}`,
    ].join("\n"),
    config: {},
  });

  assert.match(result.text, /Matched 1 PREQ project mapping/);
  assert.match(result.text, /Unmatched projects:/);
  assert.match(result.text, /MISS -> https:\/\/github.com\/sonim1\/missing-repo/);
  assert.equal(
    writtenConfig.plugins.entries["preqstation-dispatcher"].config.projects.PROJ,
    matchedRepo,
  );
  assert.equal(
    writtenConfig.plugins.entries["preqstation-dispatcher"].config.projects.MISS,
    undefined,
  );
});
