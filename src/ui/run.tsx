#!/usr/bin/env npx tsx
import React from "react";
import { render } from "ink";
import { App } from "./app.js";

const cwd = process.argv[2] || process.cwd();
render(<App cwd={cwd} />);
