#!/usr/bin/env node
import { startStdioServer } from "./server.js";
import { runCli } from "./cli.js";

async function main(): Promise<void> {
  if (process.argv[2] === "auth") {
    await runCli(process.argv.slice(3));
  } else {
    await startStdioServer();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
