import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { claudeCodeHooks, codexHooks } from "../../client/src/setup";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (path: string) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, any>;

describe("the Claude Code plugin", () => {
  const plugin = json("plugins/claude-code/.claude-plugin/plugin.json");

  test("keeps the credential in the secure store", () => {
    expect(plugin.userConfig.credential).toMatchObject({
      sensitive: true,
      required: true,
    });
  });

  test("defaults to the hosted service", () => {
    expect(plugin.userConfig.url.default).toBe("https://app.nodrail.com");
  });

  test("declares the hooks the manual setup uses", () => {
    expect(json("plugins/claude-code/hooks/hooks.json").hooks).toEqual(
      claudeCodeHooks({
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/hooks/nodrail-hook.mjs"],
      }),
    );
  });

  test("is what its marketplace points at", () => {
    const [entry] = json(".claude-plugin/marketplace.json").plugins;
    expect(entry.name).toBe(plugin.name);
    expect(entry.source).toBe("./plugins/claude-code");
  });
});

describe("the Codex plugin", () => {
  const plugin = json("plugins/codex/.codex-plugin/plugin.json");

  test("points at its hooks", () => {
    expect(plugin.hooks).toBe("./hooks/hooks.json");
  });

  test("declares hooks that say they are for Codex", () => {
    expect(json("plugins/codex/hooks/hooks.json").hooks).toEqual(
      codexHooks('node "${PLUGIN_ROOT}/hooks/nodrail-hook.mjs" codex'),
    );
  });

  test("is what its marketplace points at", () => {
    const [entry] = json(".agents/plugins/marketplace.json").plugins;
    expect(entry.name).toBe(plugin.name);
    expect(entry.source).toEqual({ source: "local", path: "./plugins/codex" });
  });
});

describe.each(["claude-code", "codex"])("the %s hook file", (name) => {
  const hook = readFileSync(
    resolve(root, "plugins", name, "hooks/nodrail-hook.mjs"),
    "utf8",
  );

  test("needs nothing installed beside it", () => {
    const external = [...hook.matchAll(/from ["']([^"']+)["']/g)]
      .map((match) => match[1] ?? "")
      .filter((source) => !source.startsWith("node:"));
    expect(external.filter((source) => !isNodeBuiltin(source))).toEqual([]);
  });
});

function isNodeBuiltin(source: string) {
  return ["crypto", "fs", "os", "path", "module", "child_process"].includes(
    source,
  );
}
