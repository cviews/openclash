#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
