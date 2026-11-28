// Verify the selected immutable tag before granting any publishing identity.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const npmTag = /^@nodrail\/(sdk|cli)@/;
const semver =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const git = (...args) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const [kind, tag] = process.argv.slice(2);
const prefix = kind === "image" ? /^v/ : kind === "npm" ? npmTag : null;
try {
  const match = prefix?.exec(tag);
  if (!match || !semver.test(tag.slice(match[0].length)))
    throw new Error("Invalid release tag.");
  const commit = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
  git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");
  appendFileSync(process.env.GITHUB_OUTPUT, `commit=${commit}\n`);
} catch (error) {
  console.error(
    error.status
      ? "Release tag is absent or outside protected main."
      : error.message,
  );
  process.exitCode = 1;
}
