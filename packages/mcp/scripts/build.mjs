import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

// Dependencies (the MCP SDK, zod, @nodrail/cli) are left to the installer.
const shared = {
  platform: "node",
  format: "esm",
  target: "node22",
  bundle: true,
  packages: "external",
};

await build({ ...shared, entryPoints: ["src/index.ts"], outdir: "dist" });

await build({
  ...shared,
  entryPoints: ["src/bin.ts"],
  outfile: "dist/nodrail-mcp.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
