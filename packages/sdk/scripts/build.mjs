import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

const shared = { platform: "node", format: "esm", target: "node22" };

// The library leaves its dependencies to the installer. Its entry points share
// one copy of each module (split into chunks), so a class the engine exports
// is the same class the client uses. src/engine.ts is the root for browsers.
await build({
  ...shared,
  entryPoints: [
    "src/index.ts",
    "src/engine.ts",
    "src/protocol.ts",
    "src/simulator.ts",
    "src/yaml.ts",
    "src/compile.ts",
    "src/actions.ts",
    "src/receipts.ts",
    "src/hook-runs.ts",
    "src/command-line.ts",
    "src/shapes/index.ts",
    "src/shapes/values.ts",
    "src/files/index.ts",
    "src/revision.ts",
    "src/run-ledger.ts",
    "src/client/langchain.ts",
    "src/client/setup.ts",
    "src/client/hooks.ts",
  ],
  outdir: "dist",
  outbase: "src",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  packages: "external",
});

// The nodrail-policy command.
await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
});

// The hook is one file, so a broken dependency cannot stop it blocking.
await build({
  ...shared,
  entryPoints: ["src/client/hook-main.ts"],
  outfile: "dist/nodrail-hook.mjs",
  bundle: true,
  minifySyntax: true,
  banner: { js: "#!/usr/bin/env node" },
});

// The SDK's brief and input checker, which the hook loads only for a call a
// declared contract covers (.nodrail/contracts.json): one file with the
// engine, yaml and zod inside, so the hook itself stays small. yaml is
// CommonJS and requires Node's modules, which an ES module can only do
// through createRequire.
await build({
  ...shared,
  entryPoints: ["src/client/contract-fields.ts"],
  outfile: "dist/nodrail-hook-contracts.mjs",
  bundle: true,
  banner: {
    js: [
      'import { createRequire as __nodrailRequire } from "node:module";',
      "const require = __nodrailRequire(import.meta.url);",
    ].join("\n"),
  },
});
