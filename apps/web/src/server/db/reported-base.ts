import type { Relation } from "typeorm";
import { Clock, Fk, inWorkspace, member } from "./columns";
import { Environment, WorkspaceMembership } from "./entities";

/**
 * What every report an installation sends shares: the environment it was
 * sent to and the person whose token sent it, and when it arrived. Not a
 * table itself: the report tables extend it.
 */
export abstract class ReportedByPerson {
  @Clock() receivedAt!: Date;
  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
  @Fk(() => WorkspaceMembership, member("user_id"))
  reporter!: Relation<WorkspaceMembership>;
}
