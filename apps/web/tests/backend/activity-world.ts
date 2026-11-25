import { readWorkspace, type HumanPrincipal } from "@/server/db/context";
import type { Role } from "@/contracts/v1/access";
import { AuditEvent } from "@/server/db/entities";
import { listActivity } from "@/server/modules/activity";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  type TestAgent,
  type TestWorkspace,
} from "./world";

export const ENV = "development";

/** One page of Activity, as this person's screen reads it. */
export const list = (
  person: HumanPrincipal,
  w: TestWorkspace,
  query: object = {},
  size?: number,
) =>
  readWorkspace(person, w.id, (context) =>
    listActivity(context, ENV, query, size),
  );

export const codes = async (
  person: HumanPrincipal,
  w: TestWorkspace,
  query: object = {},
) => (await list(person, w, query)).items.map((item) => item.code);

/** A person in this role, assigned "mine" and not "theirs". */
export async function assignedOne(role: Role) {
  const w = await createWorkspace();
  const person = await addMember(w, role);
  await createAgent(w, "mine", [person]);
  await createAgent(w, "theirs");
  return { w, person };
}

/** What the rules decided about an agent's action, as the runtime records it. */
export const decided = (
  w: TestWorkspace,
  agent: TestAgent,
  code: "allowed_by_rule" | "denied_by_rule" | "denied_no_rule",
) =>
  admin.getRepository(AuditEvent).insert({
    workspaceId: w.id,
    eventType: "authorization.decided",
    actorKind: "runtime",
    decisionCode: code,
    agentId: agent.id,
    actionRequestId: agent.actionId,
    environmentId: w.environmentId,
  });
