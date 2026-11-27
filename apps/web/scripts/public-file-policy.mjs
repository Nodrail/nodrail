import { forbiddenNames, secretPatterns } from "./secret-patterns.mjs";

const privateDirectory =
  /(?:^|\/)(?:handoffs|handovers|pilots|customers|exports|dumps|backups|private-data)\//i;
const privateDocument =
  /(?:^|\/)[^/]*(?<![a-z0-9])(?:decisions?|handoffs?|handovers?|pilots?|customers?|exports?|dumps?|backups?|invoices?|production-data|prod-data)(?![a-z0-9])[^/]*\.(?:md|mdx|rst|txt|pdf|docx?|ya?ml|jsonl?|ndjson|[ct]sv|xlsx?|sql|zip|gz)$/i;
const dataDump = /\.(?:dump|bak|sqlite3?|parquet|sql\.gz)$/i;

// The public conformance suite deliberately models a handoff document.
const handoffContract =
  "packages/policy-engine/tests/fixtures/contracts/S07/valid-handoff-and-adr.yaml";

export function publicFileProblems(path, text) {
  const problems = [];
  if (
    forbiddenNames.test(path) ||
    privateDirectory.test(path) ||
    (path !== handoffContract && privateDocument.test(path)) ||
    dataDump.test(path)
  )
    problems.push(`${path}: must not be published`);
  for (const [label, pattern] of secretPatterns)
    if (pattern.test(path) || pattern.test(text))
      problems.push(`${path}: ${label}`);
  return problems;
}
