// Proves anyone can install and use the SDK with nothing else from Nodrail:
// the real tarball, installed in an empty folder outside the monorepo.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typescript = resolve(sdk, "node_modules/typescript/bin/tsc");

// On Windows npm, pnpm and installed commands are .cmd files, which only start
// through a shell.
const shell = process.platform === "win32";
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    shell: shell && ["npm", "pnpm"].includes(command),
  });

function check(condition, message) {
  if (condition) return;
  console.error(`Package check failed: ${message}`);
  process.exitCode = 1;
  throw new Error(`Package check failed: ${message}`);
}

/** An entry's text and that of every chunk it loads, however deep. */
function withChunks(dist, entry, seen = new Set()) {
  const file = resolve(dist, entry);
  if (seen.has(file)) return "";
  seen.add(file);
  const text = readFileSync(file, "utf8");
  let all = text;
  for (const [, spec] of text.matchAll(
    /(?:\bfrom|\bimport)\s*\(?\s*"(\.\.?\/[^"]+)"/g,
  ))
    all += withChunks(dirname(file), spec, seen);
  return all;
}

const folder = mkdtempSync(join(tmpdir(), "nodrail-sdk-"));
try {
  run("pnpm", ["build"], sdk);
  run("pnpm", ["pack", "--pack-destination", folder], sdk);
  const [tarball] = readdirSync(folder).filter((name) => name.endsWith(".tgz"));
  check(tarball, "no tarball");

  const listing = run("tar", ["-tzf", tarball], folder);
  for (const forbidden of ["/src/", "/tests/", ".env", "node_modules"])
    check(!listing.includes(forbidden), `tarball contains ${forbidden}`);
  const manifest = JSON.parse(
    run("tar", ["-xzOf", tarball, "package/package.json"], folder),
  );
  const shipped = Object.keys(manifest.dependencies ?? {})
    .sort()
    .join();
  check(
    shipped === "canonicalize,yaml,zod",
    `unexpected dependencies: ${shipped}`,
  );
  check(
    !JSON.stringify(manifest).includes("workspace:"),
    "workspace dependency",
  );
  check(manifest.license === "Apache-2.0", "licence");
  check(listing.includes("package/LICENSE"), "LICENSE missing");
  check(
    !JSON.stringify(manifest.exports).includes("./src/"),
    "exports source files",
  );

  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--prefer-offline", `./${tarball}`],
    folder,
  );

  writeFileSync(
    join(folder, "use.ts"),
    `import { simulate, type PolicyDocument } from "@nodrail/sdk";
import { compilePolicies } from "@nodrail/sdk/yaml";
import { receiptBlock, runKey } from "@nodrail/sdk/hook-runs";
import { parseReceipt } from "@nodrail/sdk/receipts";
import { runPolicyCommandLine, type Io } from "@nodrail/sdk/command-line";
import { compileContracts, readContractReceipt } from "@nodrail/sdk/contracts";
import { matchWhere, validateValue } from "@nodrail/sdk/contract-values";
import { readFileContent, type FileReading } from "@nodrail/sdk/files";
import { cleanRevision, workRevision } from "@nodrail/sdk/revision";
import { record, withRunLock, settleMediatedCall, type MediatedSettlement } from "@nodrail/sdk/ledger";
import { ACCOUNTABLE_DOCUMENT_VERSION, type NumericBudget, type EvidenceNeed, type LimitState } from "@nodrail/sdk";
export const ledger: { record: typeof record; withRunLock: typeof withRunLock; settle: typeof settleMediatedCall } = { record, withRunLock, settle: settleMediatedCall };
export type Accountable = [NumericBudget, EvidenceNeed, LimitState, MediatedSettlement];
export const v4: 4 = ACCOUNTABLE_DOCUMENT_VERSION;
export const fileReading: typeof readFileContent = readFileContent;
export type Reading = FileReading;
export const clean: string | null = cleanRevision("0".repeat(40));
export const work: typeof workRevision = workRevision;
export const contracts = compileContracts({ manifest: {} }).ok;
export const reading: typeof readContractReceipt = readContractReceipt;
export const issues = validateValue({ for: null, properties: {} }, {}).length;
export const matched: boolean = matchWhere([], {});
export const block: string | null = receiptBlock("x");
export const key: string | null = runKey(".", null, {});
export const read = parseReceipt(block ?? "");
export const compiled = compilePolicies([{ name: "a.yaml", text: "" }]);
export const typed: typeof simulate = simulate;
export const shape: PolicyDocument | null = compiled.ok ? compiled.document : null;
export const commandLine: (argv: string[], io?: Io) => Promise<number> =
  runPolicyCommandLine;
`,
  );
  writeFileSync(
    join(folder, "types.ts"),
    `import { authorize, guard, NodrailClient, simulate as fromRoot, type Decision } from "@nodrail/sdk";
import { simulate } from "@nodrail/sdk/simulator";
import { codexHooks } from "@nodrail/sdk/setup";
import { runHook } from "@nodrail/sdk/hooks";
const client = new NodrailClient({ url: "u", credential: "c" });
export const decide = (): Promise<Decision> =>
  authorize(client, { tool: "t", operation: "o", resource: { kind: "k", id: "i" }, params: {} }, "k");
export const typed: typeof simulate = fromRoot;
export const hooks: typeof codexHooks = codexHooks;
export const hook: typeof runHook = runHook;
// If the types ever resolved to any, this marker would be unused and fail.
// @ts-expect-error a guarded function asks first, so it returns a promise
export const wrong: string = guard((n: number) => String(n), { name: "f" })(1);
`,
  );
  writeFileSync(
    join(folder, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "esnext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      files: ["use.ts", "types.ts"],
    }),
  );
  run(process.execPath, [typescript, "-p", "tsconfig.json"], folder);
  // The same types under Node's own resolution, which needs file extensions.
  writeFileSync(
    join(folder, "tsconfig.node.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { module: "nodenext", moduleResolution: "nodenext" },
    }),
  );
  run(process.execPath, [typescript, "-p", "tsconfig.node.json"], folder);
  // The subpaths load at runtime too, not only as types.
  const loaded = run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const files = await import("@nodrail/sdk/files");
const revision = await import("@nodrail/sdk/revision");
const ledger = await import("@nodrail/sdk/ledger");
console.log(typeof files.readFileContent, typeof files.checkWrite, revision.cleanRevision("0".repeat(40)), typeof ledger.record, typeof ledger.withRunLock, typeof ledger.settleMediatedCall);`,
    ],
    folder,
  );
  check(
    /^function function sha256:[0-9a-f]{64} function function function\n$/.test(
      loaded,
    ),
    `files, revision and ledger subpaths: ${loaded}`,
  );

  // The client: unreachable means blocked, and the example policies decide.
  writeFileSync(
    join(folder, "use.mjs"),
    `import { NodrailClient, authorize, createNodrail, simulate as fromRoot } from "@nodrail/sdk";
import { codexHooks } from "@nodrail/sdk/setup";
import { descriptorDigest } from "@nodrail/sdk/protocol";
import { simulate } from "@nodrail/sdk/simulator";
import { compilePolicies } from "@nodrail/sdk/yaml";
import { readFile } from "node:fs/promises";

// The entry points share one copy of the engine.
if (fromRoot !== simulate) throw new Error("two copies of simulate");

const descriptor = { tool: "t", operation: "o", resource: { kind: "k", id: "i" }, params: {} };
if (!descriptorDigest("i", descriptor).startsWith("sha256:")) throw new Error("digest");

const client = new NodrailClient({
  url: "https://x", credential: "c",
  fetch: async () => { throw new Error("down"); },
});
const decision = await authorize(client, descriptor, "key");
if (decision.allowed) throw new Error("allowed while unreachable");

const nodrail = createNodrail({ credential: "c", env: {}, fetch: async () => { throw new Error("down"); } });
let ran = false;
const guarded = nodrail.guard({ send: { name: "send", execute: () => { ran = true; } } });
await guarded.send.execute({});
if (ran) throw new Error("a guarded tool ran while unreachable");
if (typeof codexHooks("x").PreToolUse[0].matcher !== "string") throw new Error("setup");

const expected = { "read-allowed": "allow", "write-after-review": "deny", "deny-sensitive": "deny" };
const calls = { "read-allowed": ["issues.read", "acme/support"], "write-after-review": ["issues.update", "a/b"], "deny-sensitive": ["repositories.delete", "a/b"] };
for (const [name, outcome] of Object.entries(expected)) {
  const name_ = name + ".yaml";
  const compiled = compilePolicies([{ name: name_, text: await readFile("node_modules/@nodrail/sdk/examples/client/policies/" + name_, "utf8") }]);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  const [operationKey, resourceId] = calls[name];
  const result = simulate({
    document: compiled.document,
    descriptor: { agentId: "a", installationId: "b", toolKey: "github", operationKey, resourceKind: "repository", resourceId, params: {} },
    now: new Date("2026-11-09T12:00:00.000Z"),
  });
  if (result.outcome !== outcome) throw new Error(name + " gave " + result.outcome);
}
`,
  );
  run(process.execPath, ["use.mjs"], folder);

  const engineCli = "node_modules/@nodrail/sdk/dist/cli.js";
  const rules = "node_modules/@nodrail/sdk/examples/rules";
  const cli = (...args) =>
    spawnSync(process.execPath, [engineCli, ...args], {
      cwd: folder,
      encoding: "utf8",
    });
  const validated = cli("validate", rules);
  check(validated.status === 0, `validate failed: ${validated.stderr}`);
  const cases = cli(
    "test",
    rules,
    "--cases",
    "node_modules/@nodrail/sdk/examples/cases.yaml",
  );
  check(
    cases.status === 0,
    `example cases failed: ${cases.stdout}${cases.stderr}`,
  );
  const evaluated = cli(
    "eval",
    rules,
    "--tool=github",
    "--operation=repositories.delete",
    "--kind=repository",
    "--resource=acme/app",
  );
  check(
    evaluated.stdout.includes('"outcome": "deny"'),
    `eval: ${evaluated.stdout}`,
  );

  writeFileSync(
    join(folder, "gate.yaml"),
    `- rule: Git version
  command: { prefix: "git version" }
  effect: allow
- rule: Never remove
  command: { prefix: rm }
  effect: deny
`,
  );
  const ran = cli("exec", "gate.yaml", "--", "git", "version");
  check(
    ran.status === 0 && ran.stdout.startsWith("git version "),
    `exec: ${ran.stderr}`,
  );
  writeFileSync(join(folder, "keep.txt"), "x");
  const refused = cli("exec", "gate.yaml", "--", "rm", "keep.txt");
  check(refused.status === 126, `exec should refuse: ${refused.status}`);
  check(existsSync(join(folder, "keep.txt")), "exec ran a denied command");
  const event = (command) =>
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    });
  const hook = (command, file = "gate.yaml") =>
    spawnSync(process.execPath, [engineCli, "hook", file], {
      cwd: folder,
      encoding: "utf8",
      input: event(command),
    });
  check(hook("git version").stdout === "", "hook did not stay quiet on allow");
  check(hook("rm -rf x").stdout.includes('"deny"'), "hook did not deny");
  check(
    hook("x", "missing.yaml").status === 2,
    "hook must block without rules",
  );

  // A run through the installed hook, each event its own process as Claude Code runs it.
  const repo = join(folder, "repo");
  mkdirSync(repo);
  spawnSync("git", ["init", "-q", "-b", "work"], { cwd: repo });
  writeFileSync(
    join(repo, "runs.yaml"),
    `- required_engine_version: 3
- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow
- gate: Review first
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: exact, value: github }
  requires: [{ agent: reviewer, verdict: ship, since: [dev] }]
  otherwise: deny
`,
  );
  const installedCli = join(folder, engineCli);
  const send = (payload) =>
    spawnSync(process.execPath, [installedCli, "hook", "runs.yaml"], {
      cwd: repo,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "s", cwd: repo, ...payload }),
    });
  const dispatchGithub = () =>
    send({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "github", prompt: "open the PR" },
    }).stdout;
  check(dispatchGithub().includes('"deny"'), "gate did not hold the dispatch");
  for (const [id, type, verdict] of [
    ["d1", "dev", "done"],
    ["r1", "reviewer", "ship"],
  ]) {
    send({ hook_event_name: "SubagentStart", agent_id: id, agent_type: type });
    send({
      hook_event_name: "SubagentStop",
      agent_id: id,
      agent_type: type,
      last_assistant_message: `ok\n\`\`\`nodrail-receipt\nverdict: ${verdict}\n\`\`\``,
    });
  }
  check(dispatchGithub() === "", "gate did not open after the review");
  const listed = spawnSync(process.execPath, [installedCli, "runs"], {
    cwd: repo,
    encoding: "utf8",
  });
  // No remote, so the run is the repository folder's name and the branch.
  check(
    listed.stdout.startsWith("repo/work  2 steps"),
    `runs: ${listed.stdout}`,
  );

  // Hooks bundle these: no schema library, and reading a receipt runs no git.
  // The library's entry points share chunks, so each check reads the entry
  // and every chunk it loads.
  const installed = join(folder, "node_modules/@nodrail/sdk/dist");
  const hookRuns = withChunks(installed, "hook-runs.js");
  for (const marker of ['from "zod"', 'from "yaml"'])
    check(!hookRuns.includes(marker), `hook-runs imports ${marker}`);
  const receipts = withChunks(installed, "receipts.js");
  check(!receipts.includes("child_process"), "receipts runs git");

  const claudeHook = join("node_modules", ".bin", "nodrail-claude-hook");
  const unconfigured = spawnSync(claudeHook, [], {
    cwd: folder,
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_use_id: "t",
    }),
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    shell,
  });
  check(
    unconfigured.status === 0 &&
      unconfigured.stdout.includes('"permissionDecision":"deny"'),
    `the installed hook did not block: ${unconfigured.stdout}${unconfigured.stderr}`,
  );

  // Runs on every tool call, so it carries no schema or YAML library (the
  // markers below). The byte budget catches any other large dependency; it
  // was raised from 80,000 when descriptor-checked file reads were added.
  const bundled = readFileSync(join(installed, "nodrail-hook.mjs"), "utf8");
  check(
    Buffer.byteLength(bundled) <= 82_000,
    `the hook grew to ${Buffer.byteLength(bundled)} bytes`,
  );
  for (const marker of ["ZodError", "YAMLParseError"])
    check(!bundled.includes(marker), `the hook bundles ${marker}`);
  // One file each: a broken dependency cannot stop the hook blocking.
  for (const single of ["nodrail-hook.mjs", "nodrail-hook-contracts.mjs"])
    check(
      !/^\s*(?:import|export)\b[^;]*?\bfrom\s*"\.\.?\//m.test(
        readFileSync(join(installed, single), "utf8"),
      ),
      `${single} loads another file`,
    );
  // The checker it loads for a call a declared contract covers, next to it.
  writeFileSync(
    join(folder, "checker.mjs"),
    `const m = await import("./node_modules/@nodrail/sdk/dist/nodrail-hook-contracts.mjs");
if (typeof m.withContractFields !== "function") throw new Error("no withContractFields");
`,
  );
  run("node", ["checker.mjs"], folder);

  check(/^\d+\.\d+\.\d+/.test(cli("--version").stdout), "--version");
  check(cli("--help").stdout.includes("Usage"), "--help");
  const pack = cli("init", "repo-work");
  check(pack.status === 0, `init: ${pack.stderr}`);
  writeFileSync(join(folder, "pack.yaml"), pack.stdout);
  check(cli("validate", "pack.yaml").status === 0, "starter pack invalid");

  writeFileSync(join(folder, "bad.yaml"), "- rule: x\n  effect: maybe\n");
  const bad = cli("validate", "bad.yaml");
  check(
    bad.status === 1 && bad.stderr.includes("bad.yaml:1"),
    "bad file accepted",
  );

  console.log(
    "Package check passed: installed and used outside the monorepo, on its own.",
  );
} finally {
  rmSync(folder, { recursive: true, force: true });
}
