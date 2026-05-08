import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDispatcherCli } from "../src/cli/preqstation-dispatcher.mjs";
import {
  installOpenClawPlugin,
  uninstallOpenClawPlugin,
} from "../src/openclaw-installer.mjs";

const packageJsonPath = new URL("../package.json", import.meta.url);

async function readCurrentPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  return pkg.version;
}

async function writeFakeNpmBin(binDir, version) {
  const npmBin = path.join(binDir, "npm");
  await fs.writeFile(
    npmBin,
    [
      "#!/bin/sh",
      'if [ "$1 $2 $3 $4" = "view @sonim1/preqstation version --json" ]; then',
      `  printf '"${version}"\\n'`,
      "  exit 0",
      "fi",
      'echo "unexpected npm invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(npmBin, 0o755);
}

test("install openclaw runs the OpenClaw plugin install command", async () => {
  const currentPackageVersion = await readCurrentPackageVersion();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-openclaw-install-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "openclaw-args.log");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeNpmBin(binDir, currentPackageVersion);
  const openclawBin = path.join(binDir, "openclaw");
  await fs.writeFile(
    openclawBin,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${logFile}"`,
      'if [ "$1 $2 $3" = "plugins inspect preqstation-dispatcher" ]; then',
      `  count_file="${tempDir}/inspect-count"`,
      "  count=0",
      '  if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi',
      "  count=$((count + 1))",
      '  printf "%s" "$count" > "$count_file"',
      '  if [ "$count" -eq 1 ]; then',
      '    echo "No plugin found with id preqstation-dispatcher" >&2',
      "    exit 1",
      "  fi",
      '  cat <<\'EOF\'',
      "PREQSTATION OpenClaw Dispatch",
      "id: preqstation-dispatcher",
      `Version: ${currentPackageVersion}`,
      `Recorded version: ${currentPackageVersion}`,
      "EOF",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(openclawBin, 0o755);

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["install", "openclaw"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    (await fs.readFile(logFile, "utf8")).trim().split("\n"),
    [
      "plugins inspect preqstation-dispatcher",
      "plugins install @sonim1/preqstation --dangerously-force-unsafe-install",
      "plugins inspect preqstation-dispatcher",
    ],
  );
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    target: "openclaw",
    action: "installed",
    package: "@sonim1/preqstation",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
    package_version: currentPackageVersion,
  });
});

test("uninstallOpenClawPlugin removes the OpenClaw plugin with force", async () => {
  const calls = [];

  const result = await uninstallOpenClawPlugin({
    env: { PATH: process.env.PATH },
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.join(" ") === "plugins inspect preqstation-dispatcher") {
        return {
          stdout: "Recorded version: 0.1.36\n",
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    {
      command: "openclaw",
      args: ["plugins", "inspect", "preqstation-dispatcher"],
      options: { env: { PATH: process.env.PATH } },
    },
    {
      command: "openclaw",
      args: ["plugins", "uninstall", "preqstation-dispatcher", "--force"],
      options: { env: { PATH: process.env.PATH } },
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    target: "openclaw",
    action: "removed",
    package: "@sonim1/preqstation",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
    installed_version: "0.1.36",
  });
});

test("install openclaw reinstalls from the renamed package when the plugin already exists", async () => {
  const currentPackageVersion = await readCurrentPackageVersion();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-openclaw-update-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "openclaw-args.log");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeNpmBin(binDir, currentPackageVersion);
  const openclawBin = path.join(binDir, "openclaw");
  await fs.writeFile(
    openclawBin,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${logFile}"`,
      'if [ "$1 $2 $3" = "plugins inspect preqstation-dispatcher" ]; then',
      `  count_file="${tempDir}/inspect-count"`,
      "  count=0",
      '  if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi',
      "  count=$((count + 1))",
      '  printf "%s" "$count" > "$count_file"',
      '  if [ "$count" -eq 1 ]; then',
      "    cat <<'EOF'",
      "PREQSTATION OpenClaw Dispatch",
      "id: preqstation-dispatcher",
      "Version: 0.1.15",
      "Recorded version: 0.1.15",
      "EOF",
      "  else",
      "    cat <<'EOF'",
      "PREQSTATION OpenClaw Dispatch",
      "id: preqstation-dispatcher",
      `Version: ${currentPackageVersion}`,
      `Recorded version: ${currentPackageVersion}`,
      "EOF",
      "  fi",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(openclawBin, 0o755);

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["install", "openclaw"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    (await fs.readFile(logFile, "utf8")).trim().split("\n"),
    [
      "plugins inspect preqstation-dispatcher",
      "plugins install @sonim1/preqstation --dangerously-force-unsafe-install --force",
      "plugins inspect preqstation-dispatcher",
    ],
  );
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    target: "openclaw",
    action: "reinstalled",
    package: "@sonim1/preqstation",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
    installed_version: "0.1.15",
    package_version: currentPackageVersion,
  });
});

test("install openclaw reports failed when reinstall completes but the recorded version does not change", async () => {
  const currentPackageVersion = await readCurrentPackageVersion();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-openclaw-update-fail-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "openclaw-args.log");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeNpmBin(binDir, currentPackageVersion);
  const openclawBin = path.join(binDir, "openclaw");
  await fs.writeFile(
    openclawBin,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${logFile}"`,
      'if [ "$1 $2 $3" = "plugins inspect preqstation-dispatcher" ]; then',
      '  cat <<\'EOF\'',
      "PREQSTATION OpenClaw Dispatch",
      "id: preqstation-dispatcher",
      "Version: 0.1.15",
      "Recorded version: 0.1.15",
      "EOF",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(openclawBin, 0o755);

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["install", "openclaw"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: false,
    target: "openclaw",
    action: "failed",
    package: "@sonim1/preqstation",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
    installed_version: "0.1.15",
    package_version: currentPackageVersion,
    error: `OpenClaw plugin did not reinstall at ${currentPackageVersion}`,
  });
});

test("install openclaw reports already_current when the installed plugin version matches the package", async () => {
  const currentPackageVersion = await readCurrentPackageVersion();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-openclaw-current-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "openclaw-args.log");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeNpmBin(binDir, currentPackageVersion);
  const openclawBin = path.join(binDir, "openclaw");
  await fs.writeFile(
    openclawBin,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${logFile}"`,
      'if [ "$1 $2 $3" = "plugins inspect preqstation-dispatcher" ]; then',
      '  cat <<\'EOF\'',
      "PREQSTATION OpenClaw Dispatch",
      "id: preqstation-dispatcher",
      `Version: ${currentPackageVersion}`,
      `Recorded version: ${currentPackageVersion}`,
      "EOF",
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(openclawBin, 0o755);

  const stdout = [];
  const exitCode = await runDispatcherCli({
    argv: ["install", "openclaw"],
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: () => {} },
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    dispatchPreqRun: async () => {
      throw new Error("install must not dispatch");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    (await fs.readFile(logFile, "utf8")).trim().split("\n"),
    ["plugins inspect preqstation-dispatcher"],
  );
  assert.deepEqual(JSON.parse(stdout.join("")), {
    ok: true,
    target: "openclaw",
    action: "already_current",
    package: "@sonim1/preqstation",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
    installed_version: currentPackageVersion,
    package_version: currentPackageVersion,
  });
});

test("installOpenClawPlugin reports not_installed during update-only runs", async () => {
  const currentPackageVersion = await readCurrentPackageVersion();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-openclaw-update-only-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "openclaw-args.log");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeNpmBin(binDir, currentPackageVersion);
  const openclawBin = path.join(binDir, "openclaw");
  await fs.writeFile(
    openclawBin,
    [
      "#!/bin/sh",
      `printf '%s\\n' \"$*\" >> \"${logFile}\"`,
      'if [ "$1 $2 $3" = "plugins inspect preqstation-dispatcher" ]; then',
      '  echo "No plugin found with id preqstation-dispatcher" >&2',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(openclawBin, 0o755);

  const result = await installOpenClawPlugin({
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    updateOnly: true,
  });

  assert.deepEqual(
    (await fs.readFile(logFile, "utf8")).trim().split("\n"),
    ["plugins inspect preqstation-dispatcher"],
  );
  assert.deepEqual(result, {
    ok: true,
    target: "openclaw",
    action: "not_installed",
    package: "@sonim1/preqstation",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
    package_version: currentPackageVersion,
  });
});

test("installOpenClawPlugin treats the plugin as current when npm latest matches the installed version even if the local repo is newer", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "preqstation-openclaw-published-current-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "openclaw-args.log");
  await fs.mkdir(binDir, { recursive: true });
  await writeFakeNpmBin(binDir, "0.1.21");
  const openclawBin = path.join(binDir, "openclaw");
  await fs.writeFile(
    openclawBin,
    [
      "#!/bin/sh",
      `printf '%s\\n' \"$*\" >> \"${logFile}\"`,
      'if [ "$1 $2 $3" = "plugins inspect preqstation-dispatcher" ]; then',
      '  cat <<\'EOF\'',
      "PREQSTATION OpenClaw Dispatch",
      "id: preqstation-dispatcher",
      "Version: 0.1.21",
      "Recorded version: 0.1.21",
      "EOF",
      "  exit 0",
      "fi",
      'echo "unexpected openclaw invocation: $*" >&2',
      "exit 1",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(openclawBin, 0o755);

  const result = await installOpenClawPlugin({
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
  });

  assert.deepEqual(
    (await fs.readFile(logFile, "utf8")).trim().split("\n"),
    ["plugins inspect preqstation-dispatcher"],
  );
  assert.deepEqual(result, {
    ok: true,
    target: "openclaw",
    action: "already_current",
    package: "@sonim1/preqstation",
    plugin_id: "preqstation-dispatcher",
    restart_command: "openclaw gateway restart",
    installed_version: "0.1.21",
    package_version: "0.1.21",
    local_package_version: await readCurrentPackageVersion(),
  });
});
