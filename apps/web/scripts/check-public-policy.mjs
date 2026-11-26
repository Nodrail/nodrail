// Run from a public checkout. Report paths and policy labels, never matches.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publicFileProblems } from "./public-file-policy.mjs";
import { publicText } from "./public-text.mjs";
import { workflowProblems } from "./workflow-guard.mjs";

const git = (...args) =>
  execFileSync("git", ["--no-replace-objects", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
const root = git("rev-parse", "--show-toplevel").trim();
const files = git("ls-files", "--cached", "-z").split("\0").filter(Boolean);
const problems = files.flatMap((path) => {
  const file = join(root, path);
  if (!lstatSync(file).isFile()) return [`${path}: expected a regular file`];
  const bytes = readFileSync(file);
  const text = publicText(path, bytes) ?? bytes.toString("utf8");
  return [...publicFileProblems(path, text), ...workflowProblems(path, text)];
});
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public policy passed for ${files.length} tracked files.`);
}
