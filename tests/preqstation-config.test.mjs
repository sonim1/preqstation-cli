import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  getPreqstationConfigPath,
  getPreqstationDispatchHome,
  getPreqstationOauthPath,
  getPreqstationErrorLogPath,
  readPreqstationConfig,
} from "../src/preqstation-config.mjs";

test("uses ~/.preqstation as the default dispatcher home", () => {
  const env = { HOME: "/Users/tester" };

  assert.equal(getPreqstationDispatchHome(env), "/Users/tester/.preqstation");
  assert.equal(getPreqstationConfigPath(env), "/Users/tester/.preqstation/config.json");
  assert.equal(getPreqstationOauthPath(env), "/Users/tester/.preqstation/oauth.json");
  assert.equal(
    getPreqstationErrorLogPath(env),
    "/Users/tester/.preqstation/logs/error.log",
  );
});

test("uses the owning user ~/.preqstation outside Hermes profile homes", () => {
  const env = {
    HOME: "/Users/tester/.hermes/profiles/preq-coder/home",
    HERMES_HOME: "/Users/tester/.hermes/profiles/preq-coder",
  };

  assert.equal(getPreqstationDispatchHome(env), "/Users/tester/.preqstation");
});

test("reads legacy ~/.preqstation-dispatch config when the new config is absent", async () => {
  const readFiles = [];
  const config = await readPreqstationConfig({
    env: { HOME: "/Users/tester" },
    readFile: async (filePath, encoding) => {
      readFiles.push({ filePath, encoding });
      if (filePath === "/Users/tester/.preqstation/config.json") {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      assert.equal(filePath, "/Users/tester/.preqstation-dispatch/config.json");
      return JSON.stringify({ server_url: "https://legacy-preq.example.com/" });
    },
  });

  assert.deepEqual(config, {
    config_path: "/Users/tester/.preqstation-dispatch/config.json",
    server_url: "https://legacy-preq.example.com",
  });
  assert.deepEqual(readFiles, [
    {
      filePath: "/Users/tester/.preqstation/config.json",
      encoding: "utf8",
    },
    {
      filePath: "/Users/tester/.preqstation-dispatch/config.json",
      encoding: "utf8",
    },
  ]);
});

test("does not fall back to legacy config when PREQSTATION_DISPATCH_HOME is explicit", async () => {
  const explicitHome = path.join("/tmp", "preqstation-explicit");
  const config = await readPreqstationConfig({
    env: {
      HOME: "/Users/tester",
      PREQSTATION_DISPATCH_HOME: explicitHome,
    },
    readFile: async (filePath) => {
      assert.equal(filePath, path.join(explicitHome, "config.json"));
      throw new Error("missing");
    },
  });

  assert.deepEqual(config, {
    config_path: path.join(explicitHome, "config.json"),
    server_url: null,
  });
});
