// The browser-safe entry: `/yaml` also holds code that needs Node.
import { compilePolicies } from "@nodrail/sdk/compile";
import type {
  PolicyFileIssueDto,
  PolicyFilePreviewDto,
} from "@/contracts/v1/policies";

/** A problem in the rules file, from the browser's check or the server's review. */
export type Problem = PolicyFileIssueDto & {
  severity: "error" | "warning";
  from: "editor" | "server";
};

/** What the editor underlines: offsets into the text, as CodeMirror expects. */
export type ProblemRange = {
  from: number;
  to: number;
  severity: Problem["severity"];
  message: string;
};

const label =
  (from: Problem["from"], severity: Problem["severity"]) =>
  (issue: PolicyFileIssueDto): Problem => ({
    line: issue.line,
    column: issue.column,
    message: issue.message,
    severity,
    from,
  });

const problemKey = (problem: Problem) =>
  `${problem.line}:${problem.column}:${problem.message}`;

/** In file order, errors before warnings on the same spot, each said once. */
export function sortProblems(problems: Problem[]) {
  const seen = new Set<string>();
  return problems
    .toSorted(
      (a, b) =>
        a.line - b.line ||
        a.column - b.column ||
        Number(a.severity === "warning") - Number(b.severity === "warning"),
    )
    .filter((problem) => {
      const key = problemKey(problem);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The same check the server runs before anything else: YAML syntax and the
 * engine's compile step. It needs no Node APIs, so it runs as you type.
 */
export function lintPolicyYaml(text: string): Problem[] {
  const result = compilePolicies([{ name: "rules.yaml", text }]);
  return sortProblems([
    ...(result.ok ? [] : result.issues.map(label("editor", "error"))),
    ...result.warnings.map(label("editor", "warning")),
  ]);
}

/** What the server's review found, such as agents or installations it doesn't know. */
export function reviewProblems(
  preview: Pick<PolicyFilePreviewDto, "issues" | "warnings">,
): Problem[] {
  return [
    ...preview.issues.map(label("server", "error")),
    ...preview.warnings.map(label("server", "warning")),
  ];
}

/**
 * Line and column (from 1) as offsets. The underline covers the word there, or
 * one character; a position past the end, from older text, is pulled back in.
 */
export function problemRanges(text: string, problems: Problem[]) {
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return problems.map((problem): ProblemRange => {
    const index = Math.min(Math.max(problem.line, 1), lines.length) - 1;
    const line = lines[index] ?? "";
    const column = Math.min(Math.max(problem.column, 1) - 1, line.length);
    const word = /^\S+/.exec(line.slice(column))?.[0].length ?? 0;
    const start = (starts[index] ?? 0) + column;
    return {
      from: start,
      to: start + (word || Math.min(1, line.length - column)),
      severity: problem.severity,
      message: problem.message,
    };
  });
}
