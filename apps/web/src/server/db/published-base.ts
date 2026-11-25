import type { Relation } from "typeorm";
import { Clock, Fk, Uuid, inWorkspace, member } from "./columns";
import { Environment, WorkspaceMembership } from "./entities";

/**
 * What every record published to an environment shares: the environment,
 * the member who published it and when. Not a table itself: policy
 * versions, intended revisions and contract bindings extend it.
 */
export abstract class PublishedToEnvironment {
  @Uuid() publishedBy!: string;
  @Clock() publishedAt!: Date;
  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
  @Fk(() => WorkspaceMembership, member("published_by"))
  publisher!: Relation<WorkspaceMembership>;
}
