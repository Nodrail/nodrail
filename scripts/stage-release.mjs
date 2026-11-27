// One immutable npm tag per dispatch. Pending stages are visible to maintainers
// through npm's interactive stage commands; GitHub releases record approvals.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NPM = "npm@12.2.2";
const registry = "https://registry.npmjs.org";
const packages = {
  "@nodrail/policy-engine": "packages/policy-engine",
  "@nodrail/client": "packages/client",
  "@nodrail/cli": "packages/cli",
};

async function isLive(name, version) {
  const response = await fetch(
    `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return false;
  if (!response.ok || (await response.json()).version !== version)
    throw new Error(
      `Cannot verify npm registry state (HTTP ${response.status}).`,
    );
  return true;
}

function changesIn(directory, version) {
  const changelog = readFileSync(join(directory, "CHANGELOG.md"), "utf8");
  const start = changelog.indexOf(`## ${version}\n`);
  if (start < 0) return "";
  const body = changelog.slice(start).split("\n").slice(1);
  const end = body.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? body : body.slice(0, end)).join("\n").trim();
}

function record(directory, tag, name, version) {
  const result = execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`,
      "--jq",
      ".[].tag_name",
    ],
    { encoding: "utf8" },
  );
  if (result.split("\n").includes(tag))
    return console.log(`${tag} already recorded on GitHub.`);
  const notes = [
    changesIn(directory, version),
    `Published on npm: https://www.npmjs.com/package/${name}/v/${version}`,
  ].join("\n\n");
  execFileSync(
    "gh",
    [
      "release",
      "create",
      tag,
      "--verify-tag",
      "--title",
      `${name} ${version}`,
      "--notes",
      notes,
    ],
    { stdio: "inherit" },
  );
}

function stage(directory, tag) {
  const { EXPECTED_SHA256: expected, RELEASE_COMMIT: commit } = process.env;
  if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
    throw new Error("Staging requires the verified release commit.");
  if (expected && !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("Expected a lowercase SHA-256 checksum.");
  const folder = mkdtempSync(join(tmpdir(), "nodrail-stage-"));
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", folder], {
      cwd: directory,
      stdio: "inherit",
    });
    const files = readdirSync(folder);
    if (files.length !== 1 || !files[0].endsWith(".tgz"))
      throw new Error("Expected exactly one package tarball.");
    const tarball = join(folder, files[0]);
    const digest = createHash("sha256")
      .update(readFileSync(tarball))
      .digest("hex");
    console.log(`${tag} tarball SHA-256: ${digest}`);
    if (expected && digest !== expected)
      throw new Error(
        "Retry tarball differs from the original stage. Supersede the version.",
      );
    execFileSync(
      "npx",
      [
        "--yes",
        NPM,
        "stage",
        "publish",
        tarball,
        "--registry",
        registry,
        "--access",
        "public",
        "--provenance",
      ],
      {
        stdio: "inherit",
        // npm reads these values for the attestation's source dependency. OIDC
        // still identifies the workflow running on protected main.
        env: {
          ...process.env,
          GITHUB_SHA: commit,
          GITHUB_REF: `refs/tags/${tag}`,
        },
      },
    );
    console.log(
      `${tag} accepted for staging. Find its stage ID with npm stage list.`,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const { RELEASE_TAG: tag, RELEASE_OPERATION: operation } = process.env;
try {
  const delimiter = tag?.lastIndexOf("@") ?? -1;
  const name = tag?.slice(0, delimiter);
  const version = tag?.slice(delimiter + 1);
  const directory = packages[name];
  if (
    !Object.hasOwn(packages, name) ||
    !["stage", "record"].includes(operation)
  )
    throw new Error(
      "Select one verified npm tag and the stage or record operation.",
    );
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  if (manifest.name !== name || manifest.version !== version)
    throw new Error("The verified tag and package manifest must match.");
  const published = await isLive(name, version);
  if (operation === "record") {
    if (!published)
      throw new Error("Approve the npm stage before recording it on GitHub.");
    record(directory, tag, name, version);
  } else if (published) {
    console.log(`${tag} is already published on npm.`);
  } else {
    stage(directory, tag);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
