// Fails if anything that looks like a real credential is about to reach the repository.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  forbiddenNames,
  secretPatterns as patterns,
} from "./secret-patterns.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\0")
  .filter(Boolean);

const problems = [];
for (const file of files) {
  if (forbiddenNames.test(file)) problems.push(`${file}: should not be in git`);
  if (file === "pnpm-lock.yaml" || file.startsWith("design/")) continue;
  const path = join(root, file);
  let text;
  try {
    if (statSync(path).size > 2_000_000) continue;
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  for (const [label, pattern] of patterns)
    if (pattern.test(text)) problems.push(`${file}: ${label}`);
}

if (problems.length) {
  console.error(`Possible secrets found:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files.`);
