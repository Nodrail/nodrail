import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parseDocument } from "yaml";
import {
  connectSnippet,
  projectRuntimes,
} from "@/features/agents/setup-snippets";

const cli = fileURLToPath(
  new URL("../../../packages/cli/src/bin.ts", import.meta.url),
);
const tsx = import.meta.resolve("tsx");
const example = new URL(
  "../../../packages/cli/examples/support-desk/",
  import.meta.url,
);
const server = "https://console.example.test";
const place = { workspace: "desk", environment: "development" };

test("the CLI locks the generated credential-free project manifest for each host", async () => {
  const home = await mkdtemp(join(tmpdir(), "nodrail-console-cli-"));
  try {
    for (const { key } of projectRuntimes) {
      const cwd = join(home, key);
      await cp(example, cwd, { recursive: true });
      const path = join(cwd, "nodrail.yaml");
      const manifest = parseDocument(await readFile(path, "utf8"));
      manifest.set("id", "f18fd19e-c75c-404c-9cec-bad209b0d523");
      manifest.set("runtimes", [key]);
      await writeFile(
        path,
        `${manifest.toString()}
${connectSnippet(server, place)}
`,
      );
      const output = execFileSync(
        process.execPath,
        ["--import", tsx, cli, "policy", "lock"],
        {
          cwd,
          env: {
            HOME: home,
            USERPROFILE: home,
            PATH: process.env.PATH,
            NODE_ENV: "test",
          },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10_000,
        },
      );
      expect(output).toContain("nodrail.lock.yaml");
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 35_000);
