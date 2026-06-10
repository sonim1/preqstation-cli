import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  inspectRuntimeWorkerSupport,
  inspectRuntimeExecutableHealth,
  installRuntimeWorkerSupport,
  uninstallRuntimeWorkerSupport,
} from "../src/runtime-skill-installer.mjs";

function createFetchVersion(version) {
  return async () => ({
    ok: true,
    async json() {
      return { version };
    },
  });
}

test("inspectRuntimeExecutableHealth reports ready when Codex resolves to a stable path", async () => {
  const results = await inspectRuntimeExecutableHealth({
    runtimes: ["codex"],
    exec: async (command, args) => {
      assert.equal(command, "sh");
      assert.match(args.join(" "), /which -a codex/);
      return {
        stdout: "/Users/kendrick/.local/bin/codex\n",
        stderr: "",
      };
    },
  });

  assert.deepEqual(results, [
    {
      ok: true,
      target: "codex",
      category: "runtime_executable",
      action: "ready",
      executable: "codex",
      resolved_path: "/Users/kendrick/.local/bin/codex",
    },
  ]);
});

test("uninstallRuntimeWorkerSupport removes Codex skill binding", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-runtime-uninstall-"));
  const skillPath = path.join(tempDir, ".codex", "skills", "preqstation");
  await fs.mkdir(skillPath, { recursive: true });
  await fs.writeFile(
    path.join(skillPath, "package.json"),
    JSON.stringify({ version: "0.1.45" }),
    "utf8",
  );
  const calls = [];

  const results = await uninstallRuntimeWorkerSupport({
    runtimes: ["codex"],
    env: { HOME: tempDir, PATH: process.env.PATH },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.join(" ") === "skills ls -g --json") {
        return {
          stdout: JSON.stringify([
            {
              name: "preqstation",
              path: skillPath,
              agents: ["Codex"],
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    {
      command: "npx",
      args: ["skills", "ls", "-g", "--json"],
      options: { env: { HOME: tempDir, PATH: process.env.PATH } },
    },
    {
      command: "npx",
      args: ["skills", "remove", "preqstation", "-g", "-a", "codex", "-y"],
      options: { env: { HOME: tempDir, PATH: process.env.PATH } },
    },
  ]);
  assert.deepEqual(results, [
    {
      ok: true,
      target: "codex",
      action: "removed",
      installed_version: "0.1.45",
      skill_path: skillPath,
    },
  ]);
  await assert.rejects(fs.stat(skillPath), /ENOENT/);
});

test("inspectRuntimeExecutableHealth warns when Gemini resolves to an fnm multishell path for OpenClaw", async () => {
  const results = await inspectRuntimeExecutableHealth({
    runtimes: ["gemini-cli"],
    launchHosts: ["openclaw"],
    exec: async (command, args) => {
      assert.equal(command, "sh");
      assert.match(args.join(" "), /which -a gemini/);
      return {
        stdout: [
          "/Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini",
          "/Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini",
          "",
        ].join("\n"),
        stderr: "",
      };
    },
  });

  assert.deepEqual(results, [
    {
      ok: true,
      target: "gemini-cli",
      category: "runtime_executable",
      action: "needs_attention",
      executable: "gemini",
      resolved_path: "/Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini",
      alternate_path: "/Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini",
      error:
        "OpenClaw dispatches may not inherit /Users/kendrick/.local/state/fnm_multishells/12345/bin/gemini (session-scoped fnm path). Expose /Users/kendrick/.local/share/fnm/node-versions/v24.13.0/installation/bin/gemini via /usr/local/bin/gemini or another stable PATH entry.",
    },
  ]);
});

test("inspectRuntimeExecutableHealth fails when Gemini is missing from PATH", async () => {
  const results = await inspectRuntimeExecutableHealth({
    runtimes: ["gemini-cli"],
    launchHosts: ["openclaw"],
    exec: async (command, args) => {
      assert.equal(command, "sh");
      assert.match(args.join(" "), /which -a gemini/);
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(results, [
    {
      ok: false,
      target: "gemini-cli",
      category: "runtime_executable",
      action: "unavailable",
      executable: "gemini",
      error:
        "gemini command not found on PATH. OpenClaw dispatches will fail until gemini is installed in a stable executable location.",
    },
  ]);
});

test("installRuntimeWorkerSupport reports Codex already_current when the installed skill matches the latest version", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-skill-codex-current-"));
  const skillDir = path.join(tempDir, "preqstation");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "package.json"),
    JSON.stringify({ name: "preqstation-skill", version: "0.1.35" }),
    "utf8",
  );
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# preqstation\n", "utf8");

  const calls = [];
  const results = await installRuntimeWorkerSupport({
    runtimes: ["codex"],
    env: { PATH: process.env.PATH },
    fetchFn: createFetchVersion("0.1.35"),
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "npx" && args.join(" ") === "skills ls -g --json") {
        return {
          stdout: JSON.stringify([
            {
              name: "preqstation",
              path: skillDir,
              scope: "global",
              agents: ["Codex"],
            },
          ]),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [{ command: "npx", args: ["skills", "ls", "-g", "--json"] }],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "codex",
      action: "already_current",
      installed_version: "0.1.35",
      latest_version: "0.1.35",
      skill_path: skillDir,
    },
  ]);
});

test("inspectRuntimeWorkerSupport flags legacy pre-CLI-first skill installs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-skill-codex-legacy-"));
  const skillDir = path.join(tempDir, ".codex", "skills", "preqstation");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "package.json"),
    JSON.stringify({ name: "preqstation-skill", version: "0.1.45" }),
    "utf8",
  );

  const results = await inspectRuntimeWorkerSupport({
    runtimes: ["codex"],
    env: { PATH: process.env.PATH, HOME: tempDir },
    fetchFn: createFetchVersion("0.1.45"),
    exec: async (command, args) => {
      if (command === "npx" && args.join(" ") === "skills ls -g --json") {
        return {
          stdout: JSON.stringify([
            {
              name: "preqstation",
              path: skillDir,
              scope: "global",
              agents: ["Codex"],
            },
          ]),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(results, [
    {
      ok: true,
      target: "codex",
      action: "needs_attention",
      installed_version: "0.1.45",
      latest_version: "0.1.45",
      configured_agents: ["Codex"],
      minimum_cli_first_skill_version: "0.1.46",
      legacy_skill: true,
    },
  ]);
});

test("installRuntimeWorkerSupport updates Gemini when the skill is installed for the agent but outdated", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-skill-gemini-update-"));
  const skillDir = path.join(tempDir, "preqstation");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "package.json"),
    JSON.stringify({ name: "preqstation-skill", version: "0.1.20" }),
    "utf8",
  );

  const calls = [];
  const results = await installRuntimeWorkerSupport({
    runtimes: ["gemini-cli"],
    env: { PATH: process.env.PATH, HOME: tempDir },
    fetchFn: createFetchVersion("0.1.35"),
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "npx" && args.join(" ") === "skills ls -g --json") {
        return {
          stdout: JSON.stringify([
            {
              name: "preqstation",
              path: skillDir,
              scope: "global",
              agents: ["Gemini CLI"],
            },
          ]),
          stderr: "",
        };
      }
      if (command === "npx" && args.join(" ") === "skills update preqstation -g -y") {
        await fs.writeFile(
          path.join(skillDir, "package.json"),
          JSON.stringify({ name: "preqstation-skill", version: "0.1.35" }),
          "utf8",
        );
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
      { command: "npx", args: ["skills", "update", "preqstation", "-g", "-y"] },
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
    ],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "gemini-cli",
      action: "updated",
      installed_version: "0.1.35",
      latest_version: "0.1.35",
      skill_path: skillDir,
    },
  ]);
});

test("installRuntimeWorkerSupport installs the Codex skill when it is missing for that agent", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-skill-codex-install-"));
  const skillDir = path.join(tempDir, "preqstation");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "package.json"),
    JSON.stringify({ name: "preqstation-skill", version: "0.1.35" }),
    "utf8",
  );

  const calls = [];
  let listCallCount = 0;
  const results = await installRuntimeWorkerSupport({
    runtimes: ["codex"],
    env: { PATH: process.env.PATH, HOME: tempDir },
    fetchFn: createFetchVersion("0.1.35"),
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "npx" && args.join(" ") === "skills ls -g --json") {
        listCallCount += 1;
        return {
          stdout: JSON.stringify([
            {
              name: "preqstation",
              path: skillDir,
              scope: "global",
              agents: listCallCount === 1 ? ["Claude Code"] : ["Claude Code", "Codex"],
            },
          ]),
          stderr: "",
        };
      }
      if (
        command === "npx" &&
        args.join(" ") === "skills add sonim1/preqstation-skill -g -a codex -y"
      ) {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
      { command: "npx", args: ["skills", "add", "sonim1/preqstation-skill", "-g", "-a", "codex", "-y"] },
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
    ],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "codex",
      action: "installed",
      installed_version: "0.1.35",
      latest_version: "0.1.35",
      skill_path: skillDir,
    },
  ]);
});

test("installRuntimeWorkerSupport falls back to an agent-specific Codex skill copy when skills add does not enable the agent", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-skill-codex-fallback-"));
  const skillDir = path.join(tempDir, "preqstation");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "package.json"),
    JSON.stringify({ name: "preqstation-skill", version: "0.1.35" }),
    "utf8",
  );

  const calls = [];
  let listCallCount = 0;
  const results = await installRuntimeWorkerSupport({
    runtimes: ["codex"],
    env: { PATH: process.env.PATH, HOME: tempDir },
    fetchFn: createFetchVersion("0.1.35"),
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "npx" && args.join(" ") === "skills ls -g --json") {
        listCallCount += 1;
        return {
          stdout: JSON.stringify([
            {
              name: "preqstation",
              path:
                listCallCount >= 3 ? path.join(tempDir, ".codex", "skills", "preqstation") : skillDir,
              scope: "global",
              agents: listCallCount >= 3 ? ["Codex"] : ["Claude Code"],
            },
          ]),
          stderr: "",
        };
      }
      if (
        command === "npx" &&
        args.join(" ") === "skills add sonim1/preqstation-skill -g -a codex -y"
      ) {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  const codexSkillDir = path.join(tempDir, ".codex", "skills", "preqstation");
  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
      { command: "npx", args: ["skills", "add", "sonim1/preqstation-skill", "-g", "-a", "codex", "-y"] },
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
    ],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "codex",
      action: "installed",
      installed_version: "0.1.35",
      latest_version: "0.1.35",
      skill_path: codexSkillDir,
    },
  ]);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(codexSkillDir, "package.json"), "utf8")).version,
    "0.1.35",
  );
});

test("installRuntimeWorkerSupport fails when Codex still is not enabled after install and fallback sync", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-skill-codex-install-fail-"));
  const calls = [];
  const results = await installRuntimeWorkerSupport({
    runtimes: ["codex"],
    env: { PATH: process.env.PATH, HOME: tempDir },
    fetchFn: createFetchVersion("0.1.35"),
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "npx" && args.join(" ") === "skills ls -g --json") {
        return {
          stdout: JSON.stringify([]),
          stderr: "",
        };
      }
      if (
        command === "npx" &&
        args.join(" ") === "skills add sonim1/preqstation-skill -g -a codex -y"
      ) {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
      { command: "npx", args: ["skills", "add", "sonim1/preqstation-skill", "-g", "-a", "codex", "-y"] },
      { command: "npx", args: ["skills", "ls", "-g", "--json"] },
    ],
  );
  assert.deepEqual(results, [
    {
      ok: false,
      target: "codex",
      action: "failed",
      installed_version: null,
      latest_version: "0.1.35",
      skill_path: null,
      configured_agents: [],
      error: "preqstation skill did not become enabled for Codex after install",
    },
  ]);
});

test("installRuntimeWorkerSupport reports Codex not_enabled during update-only runs when the skill exists for other agents", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-skill-codex-skip-"));
  const skillDir = path.join(tempDir, "preqstation");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "package.json"),
    JSON.stringify({ name: "preqstation-skill", version: "0.1.35" }),
    "utf8",
  );

  const calls = [];
  const results = await installRuntimeWorkerSupport({
    runtimes: ["codex"],
    env: { PATH: process.env.PATH, HOME: tempDir },
    fetchFn: createFetchVersion("0.1.35"),
    installMissing: false,
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "npx" && args.join(" ") === "skills ls -g --json") {
        return {
          stdout: JSON.stringify([
            {
              name: "preqstation",
              path: skillDir,
              scope: "global",
              agents: ["Claude Code"],
            },
          ]),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [{ command: "npx", args: ["skills", "ls", "-g", "--json"] }],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "codex",
      action: "not_enabled",
      installed_version: "0.1.35",
      latest_version: "0.1.35",
      skill_path: skillDir,
      configured_agents: ["Claude Code"],
    },
  ]);
});

test("installRuntimeWorkerSupport installs the Claude plugin from the PREQ marketplace when missing", async () => {
  const calls = [];
  const results = await installRuntimeWorkerSupport({
    runtimes: ["claude-code"],
    env: { PATH: process.env.PATH },
    fetchFn: createFetchVersion("0.1.35"),
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "claude" && args.join(" ") === "plugin list") {
        return { stdout: "Installed plugins:\n", stderr: "" };
      }
      if (command === "claude" && args.join(" ") === "plugin marketplace list") {
        return { stdout: "Configured marketplaces:\n", stderr: "" };
      }
      if (
        command === "claude" &&
        args.join(" ") === "plugin marketplace add https://github.com/sonim1/preqstation-skill"
      ) {
        return { stdout: "", stderr: "" };
      }
      if (command === "claude" && args.join(" ") === "plugin install preqstation@preqstation") {
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "claude", args: ["plugin", "list"] },
      { command: "claude", args: ["plugin", "marketplace", "list"] },
      {
        command: "claude",
        args: ["plugin", "marketplace", "add", "https://github.com/sonim1/preqstation-skill"],
      },
      { command: "claude", args: ["plugin", "install", "preqstation@preqstation"] },
    ],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "claude-code",
      action: "installed",
      installed_version: "0.1.35",
      latest_version: "0.1.35",
      marketplace_added: true,
    },
  ]);
});

test("installRuntimeWorkerSupport reports Claude not_installed during update-only runs", async () => {
  const calls = [];
  const results = await installRuntimeWorkerSupport({
    runtimes: ["claude-code"],
    env: { PATH: process.env.PATH },
    fetchFn: createFetchVersion("0.1.35"),
    installMissing: false,
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "claude" && args.join(" ") === "plugin list") {
        return { stdout: "Installed plugins:\n", stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [{ command: "claude", args: ["plugin", "list"] }],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "claude-code",
      action: "not_installed",
      installed_version: null,
      latest_version: "0.1.35",
      marketplace_added: false,
    },
  ]);
});

test("uninstallRuntimeWorkerSupport removes the Claude Code plugin", async () => {
  const calls = [];
  const results = await uninstallRuntimeWorkerSupport({
    runtimes: ["claude-code"],
    env: { PATH: process.env.PATH },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "claude" && args.join(" ") === "plugin list") {
        return {
          stdout: [
            "Installed plugins:",
            "",
            "  ❯ preqstation@preqstation",
            "    Version: 0.1.45",
            "    Scope: user",
          ].join("\n"),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "claude", args: ["plugin", "list"] },
      {
        command: "claude",
        args: ["plugin", "uninstall", "preqstation@preqstation", "--scope", "user", "-y"],
      },
    ],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "claude-code",
      action: "removed",
      installed_version: "0.1.45",
    },
  ]);
});

test("installRuntimeWorkerSupport reports Claude already_current when the installed plugin matches the latest version", async () => {
  const calls = [];
  const results = await installRuntimeWorkerSupport({
    runtimes: ["claude-code"],
    env: { PATH: process.env.PATH },
    fetchFn: createFetchVersion("0.1.35"),
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "claude" && args.join(" ") === "plugin list") {
        return {
          stdout: [
            "Installed plugins:",
            "",
            "  ❯ preqstation@preqstation",
            "    Version: 0.1.35",
            "    Scope: user",
            "    Status: ✔ enabled",
          ].join("\n"),
          stderr: "",
        };
      }
      if (command === "claude" && args.join(" ") === "plugin marketplace list") {
        return {
          stdout: [
            "Configured marketplaces:",
            "",
            "  ❯ preqstation",
            "    Source: Git (https://github.com/sonim1/preqstation-skill.git)",
          ].join("\n"),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    [
      { command: "claude", args: ["plugin", "list"] },
      { command: "claude", args: ["plugin", "marketplace", "list"] },
    ],
  );
  assert.deepEqual(results, [
    {
      ok: true,
      target: "claude-code",
      action: "already_current",
      installed_version: "0.1.35",
      latest_version: "0.1.35",
      marketplace_added: false,
    },
  ]);
});
