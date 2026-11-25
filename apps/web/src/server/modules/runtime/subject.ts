import "server-only";
import { storedSubject } from "@/contracts/v1/runtime";
import type { RuntimeContext } from "@/server/db/context";

/**
 * The work revision an installation sent with an action (`run.subject`, at
 * submit) or again with its permit (`subject`), kept for gates on
 * `subject: revision`. Null is a revision it couldn't read: unknown. Not
 * sent at all (an older client) keeps nothing, so the two stay apart.
 */
export async function recordSubject(
  context: RuntimeContext,
  actionId: string,
  stage: "submit" | "permit",
  subject: string | null | undefined,
) {
  if (subject === undefined) return;
  await context.manager.query(
    `INSERT INTO nodrail.action_subjects
       (workspace_id, action_request_id, stage, revision)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [context.workspaceId, actionId, stage, storedSubject(subject)],
  );
}
