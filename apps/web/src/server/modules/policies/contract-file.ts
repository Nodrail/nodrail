import "server-only";
import { hasContracts, type PolicyDocument } from "@nodrail/sdk";
import { renderPolicies } from "@nodrail/sdk/yaml";
import { isMap, isSeq, parseDocument } from "yaml";
import { VERSION_NOT_RENDERABLE_MESSAGE } from "@/contracts/v1/policies";
import { AppError } from "@/server/db/context";
import { unreportedPaths } from "@/server/modules/runs/contracts";
import type { Issue } from "./run-policy";

/**
 * A live document as the file that applies back to it. A version 4 policy
 * can't be rendered yet and Cloud keeps no published file, so it is
 * refused plainly (409 `VERSION_NOT_RENDERABLE`, with why), never a failure.
 */
export function fileOf(document: PolicyDocument) {
  if (document.version === 4)
    throw new AppError(
      "VERSION_NOT_RENDERABLE",
      VERSION_NOT_RENDERABLE_MESSAGE,
    );
  return renderPolicies(document);
}

/**
 * What a preview says about contracts Cloud can't fully honour: `where` on
 * unreported paths, and evidence requirements it doesn't check yet. At the
 * entry's line: rules carry theirs (`ruleLines`), gates are found by name.
 */
export function contractWarnings(
  document: PolicyDocument,
  text: string,
  ruleLines: ReadonlyMap<string, number>,
): Issue[] {
  const gates = gateLines(text);
  const lineOf = (name: string) => ruleLines.get(name) ?? gates.get(name) ?? 1;
  return [
    ...unreportedWhere(document, lineOf),
    ...uncheckedEvidence(document, lineOf),
  ];
}

/**
 * What a rules file's `contracts` entry says that its compiled document
 * doesn't keep: each operation's input shape by name, since a stored
 * contract revision is named by its shape. Read again from the text after
 * the engine compiled it, so nothing here decides validity. A rules file
 * can't declare an operation's `resource` (the engine refuses the key), so
 * a resource id read from a classified argument can't come through a
 * publish here; nodrail.yaml's compiler must refuse it.
 */

/** Each declared operation's input shape, by `<connection>.<operation>`. */
export function inputShapeNames(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const document = parseDocument(text);
  if (!isSeq(document.contents)) return found;
  for (const item of document.contents.items) {
    if (!isMap(item) || !item.has("contracts")) continue;
    const connections = item.getIn(["contracts", "connections"], true);
    if (!isMap(connections)) continue;
    for (const connection of connections.items) {
      const operations = isMap(connection.value)
        ? connection.value.get("operations", true)
        : null;
      if (!isMap(operations)) continue;
      for (const operation of operations.items) {
        const input = isMap(operation.value)
          ? operation.value.get("input")
          : null;
        if (typeof input === "string")
          found.set(
            `${String(connection.key)}.${String(operation.key)}`,
            input,
          );
      }
    }
  }
  return found;
}

/**
 * A `where` on a path the contract doesn't report is never met in
 * Cloud, which only sees reported values. Said at its rule, not refused:
 * the file still means the same locally.
 */
export function unreportedWhere(
  document: PolicyDocument,
  lineOf: (name: string) => number,
): Issue[] {
  if (!hasContracts(document)) return [];
  const entries = [
    ...document.rules.map((rule) => ({ ...rule, kind: "rule" })),
    ...document.gates.map((gate) => ({ ...gate, kind: "gate" })),
  ];
  return entries.flatMap((entry) => {
    const paths = unreportedPaths(document, entry);
    if (!paths.length) return [];
    const effect =
      entry.kind === "rule" && entry.effect === "allow"
        ? "this allow never matches in Cloud"
        : `this ${entry.kind} applies in Cloud whatever the values`;
    return [
      {
        line: lineOf(entry.name),
        column: 1,
        message: `${entry.name}: where reads ${paths.join(", ")}, which the contract doesn't report (report: true), so Cloud never sees it: ${effect}.`,
      },
    ];
  });
}

/**
 * Where each gate starts in the file (`- gate: <name>`), by name: the
 * compiled rules carry their own lines, gates don't. A gate written some
 * other way falls back to line 1 at the caller.
 */
export function gateLines(text: string): Map<string, number> {
  const found = new Map<string, number>();
  text.split("\n").forEach((line, index) => {
    const match = /^\s*-\s+gate:\s*(.+?)\s*$/.exec(line);
    const name = match?.[1]?.replace(/^(["'])(.*)\1$/, "$2");
    if (name && !found.has(name)) found.set(name, index + 1);
  });
  return found;
}

/**
 * Evidence requirements (document version 4) aren't checked by Cloud yet,
 * so a gate with one is never met here: every call it covers is held. Said
 * at each requirement's gate, so a preview never looks clean when Cloud
 * will deny; locally the hook checks evidence as the file says.
 */
export function uncheckedEvidence(
  document: PolicyDocument,
  lineOf: (name: string) => number,
): Issue[] {
  if (document.version !== 4) return [];
  return document.gates.flatMap((gate) =>
    (gate.evidence ?? []).map((need) => ({
      line: lineOf(gate.name),
      column: 1,
      message: `${gate.name}: requires evidence ${need.evidence}, which Cloud doesn't check yet, so in Cloud this gate stays closed and holds every call it covers until evidence gates ship there.`,
    })),
  );
}
