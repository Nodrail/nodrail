import "server-only";
import { randomUUID } from "node:crypto";
import type { PolicyDocument } from "@nodrail/sdk";
import { renderPolicies } from "@nodrail/sdk/yaml";
import type { PolicyFileResultDto } from "@/contracts/v1/policies";
import type { RunPolicyChange } from "@/contracts/v1/runs";
import { AppError } from "@/server/db/context";
import {
  requireReviewedRepository,
  type PolicyWriteContext,
} from "./repository";
import { publishPlanned } from "./publish";
import { lockEnvironment } from "./environment-lock";
import { livePolicy, namedDocument, plan } from "./rule-files";

// One gate or budget changed from its form: the live file with that change,
// checked and published the way the YAML tab publishes a file.

/** The document with one gate or budget added, changed or removed. */
function withChange(
  document: PolicyDocument,
  change: RunPolicyChange,
): PolicyDocument {
  const next =
    document.version === 2
      ? { ...document }
      : { ...document, version: 2 as const, gates: [], budgets: [] };
  const replace = <T extends { id: string }>(entries: T[], entry: T | null) => {
    if (change.id === null) return entry ? [...entries, entry] : entries;
    if (!entries.some((item) => item.id === change.id))
      throw new AppError("NOT_FOUND");
    return entry
      ? entries.map((item) => (item.id === change.id ? entry : item))
      : entries.filter((item) => item.id !== change.id);
  };
  const id = change.id ?? randomUUID();
  if (change.kind === "budget") {
    next.budgets = replace(
      next.budgets,
      change.entry ? { ...change.entry, id } : null,
    );
    return next;
  }
  const before = next.gates.find((gate) => gate.id === change.id);
  next.gates = replace(
    next.gates,
    change.entry
      ? {
          // What the form doesn't show stays as the file wrote it.
          installationName: before?.installationName ?? null,
          conditions: before?.conditions ?? [],
          expiresAt: before?.expiresAt ?? null,
          ...change.entry,
          id,
        }
      : null,
  );
  return next;
}

/**
 * Adds, changes or removes one gate or budget, as one new version. It is the
 * live file with that change, checked and published the way the YAML tab
 * publishes, so a form can't save what the file would refuse.
 */
export async function changeRunPolicy(
  context: PolicyWriteContext,
  environmentSlug: string,
  change: RunPolicyChange,
  expectedRevision: number,
): Promise<
  { ok: true; result: PolicyFileResultDto } | { ok: false; problems: string[] }
> {
  const environmentId = await lockEnvironment(context, environmentSlug);
  await requireReviewedRepository(context, environmentId);
  const live = await livePolicy(context, environmentId);
  if (live.revision !== expectedRevision) throw new AppError("RULE_CHANGED");
  const named = await namedDocument(context, environmentId);
  // The form rewrites the file, and a version 4 file can't be written back
  // yet: its numeric budgets and evidence would be lost, never kept.
  if (named.version === 4)
    return {
      ok: false,
      problems: [
        "This version has numeric budgets or evidence requirements. Change it in the YAML file.",
      ],
    };
  const document = withChange(named, change);
  const planned = await plan(context, environmentId, renderPolicies(document));
  if (planned.issues.length)
    return {
      ok: false,
      problems: [...new Set(planned.issues.map((issue) => issue.message))],
    };
  return {
    ok: true,
    result: await publishPlanned(context, environmentId, planned),
  };
}
