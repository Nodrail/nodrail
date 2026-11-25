// Puts the one-file hook in each plugin, writes the hook declarations, and gives
// each plugin the version of @nodrail/client, whose hook it ships.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeHooks, codexHooks } from "../../client/dist/setup.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hookFile = resolve(root, "../client/dist/nodrail-hook.mjs");

const plugins = {
  "claude-code": claudeCodeHooks({
    command: "node",
    args: ["${CLAUDE_PLUGIN_ROOT}/hooks/nodrail-hook.mjs"],
  }),
  codex: codexHooks('node "${PLUGIN_ROOT}/hooks/nodrail-hook.mjs" codex'),
};

for (const [name, hooks] of Object.entries(plugins)) {
  const folder = resolve(root, "plugins", name, "hooks");
  copyFileSync(hookFile, resolve(folder, "nodrail-hook.mjs"));
  writeFileSync(
    resolve(folder, "hooks.json"),
    `${JSON.stringify({ hooks }, null, 2)}\n`,
  );
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const { version } = readJson(resolve(root, "../client/package.json"));
for (const manifest of [
  "plugins/claude-code/.claude-plugin/plugin.json",
  "plugins/codex/.codex-plugin/plugin.json",
  "package.json",
]) {
  const path = resolve(root, manifest);
  const data = readJson(path);
  if (data.version === version) continue;
  data.version = version;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
