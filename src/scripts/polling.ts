#!/usr/bin/env -S npx --yes tsx
// CLI: npx tsx polling.ts --cwd <cwd> --message <text> [--interval <minutes>]

import { parseArgs } from "node:util";
import { runPolling } from "../services/polling.js";

function main(): void {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string" },
      message: { type: "string" },
      interval: { type: "string", default: "1" },
    },
    strict: true,
  });

  if (!values.cwd) {
    console.error("missing --cwd");
    process.exit(2);
  }
  if (!values.message) {
    console.error("missing --message");
    process.exit(2);
  }

  const intervalMinutes = Number.parseInt(values.interval ?? "1", 10);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    console.error(`invalid --interval: ${values.interval} (must be integer ≥ 1)`);
    process.exit(2);
  }

  runPolling({
    cwd: values.cwd,
    message: values.message,
    intervalMinutes,
  });
}

main();
