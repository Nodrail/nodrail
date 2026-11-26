import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const marketplaceFiles = [
  ".agents",
  ".claude-plugin",
  "CHANGELOG.md",
  "README.md",
  "plugins",
  "scripts/check.mjs",
  "scripts/mock-nodrail.mjs",
  "scripts/real-agents.mjs",
  "scripts/verify-hook.mjs",
  "tools/package.json",
  "tools/package-lock.json",
  "tools/fuzz-hook.js",
];

const here = dirname(fileURLToPath(import.meta.url));

export function generateMarketplace(target) {
  mkdirSync(target, { recursive: true });
  if (readdirSync(target).length)
    throw new Error("The marketplace destination must be empty.");
  const plugins = resolve(here, "../../packages/agent-plugins");
  cpSync(join(here, "template"), target, { recursive: true });
  for (const path of [
    ...marketplaceFiles,
    "plugins/claude-code/hooks/nodrail-hook.mjs",
    "plugins/codex/hooks/nodrail-hook.mjs",
  ]) {
    const destination = join(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(plugins, path), destination, { recursive: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 3)
    throw new Error("Usage: generate.mjs <empty directory>");
  generateMarketplace(resolve(process.argv[2]));
}
