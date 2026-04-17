#!/usr/bin/env -S npx --yes tsx
// CLI: npx tsx scheduler.ts --cwd <path>

import { parseArgs } from "node:util";
import { runScheduler } from "../services/scheduler.js";

function main(): void {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string" },
    },
    strict: true,
  });

  if (!values.cwd) {
    console.error("missing --cwd");
    process.exit(2);
  }

  runScheduler({ cwd: values.cwd });
}

main();
