#!/usr/bin/env node
// `pnpm dev`: checks the Node version, loads .env, then starts every service through Turborepo.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_NODE = [22, 19];

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  console.error(`\nVeil needs Node ${MIN_NODE.join(".")} or newer, but this terminal is using ${process.version}.`);
  console.error("link-scraper crashes on older versions. Switch with `nvm use 22`, then run `pnpm dev` again.\n");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Variables already set in the shell take priority over .env.
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.warn("No .env file found. Services will use their localhost defaults.");
}

// Turborepo hides variables not declared in turbo.json unless env mode is loose.
const child = spawn("pnpm exec turbo run dev --parallel --env-mode=loose", {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
