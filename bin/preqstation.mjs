#!/usr/bin/env node
import { runDispatcherCli } from "../src/cli/preqstation-dispatcher.mjs";

process.exitCode = await runDispatcherCli({
  argv: process.argv.slice(2),
});
