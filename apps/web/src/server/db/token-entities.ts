import { Check, Column, Entity, Index, Unique, type Relation } from "typeorm";
import {
  Clock,
  Fk,
  Id,
  Int,
  OptionalTime,
  OptionalUuid,
  Text,
  Uuid,
  member,
  schema,
} from "./columns";
import { WorkspaceMembership } from "./entities";

/**
 * A person's token for the personal API, in one workspace. Only a digest of
 * the secret is kept. It can never do more than the person's role allows at
 * the moment of each call, whatever its scopes say.
 */
@Entity({ schema, name: "personal_access_tokens" })
@Unique(["publicPrefix"])
@Unique(["workspaceId", "id", "userId"])
@Index("personal_access_tokens_owner", ["workspaceId", "userId"])
@Check("personal_access_tokens_prefix", `"public_prefix" ~ '^[0-9a-f]{12}$'`)
@Check("personal_access_tokens_name", `length("name") BETWEEN 1 AND 60`)
@Check(
  "personal_access_tokens_scopes",
  `"scopes" <@ ARRAY['read', 'rules:write', 'inventory:write', 'agents:manage', 'members:manage', 'workspace:settings']::text[] AND ('read' = ANY ("scopes") OR "scopes" = ARRAY['inventory:write']::text[])`,
)
@Check(
  "personal_access_tokens_expiry",
  `"expires_at" IS NULL OR "expires_at" > "created_at"`,
)
@Check(
  "personal_access_tokens_revoked",
  `("revoked_at" IS NULL) = ("revoked_by" IS NULL)`,
)
export class PersonalAccessToken {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() userId!: string;
  @Text() name!: string;
  @Text() publicPrefix!: string;
  @Text() secretDigest!: string;
  @Column({ type: "text", array: true }) scopes!: string[];
  @Clock() createdAt!: Date;
  @OptionalTime() expiresAt!: Date | null;
  @OptionalTime() lastUsedAt!: Date | null;
  @OptionalTime() revokedAt!: Date | null;
  @OptionalUuid() revokedBy!: string | null;
  /** The minute being counted for the rate limit, and the calls in it. */
  @OptionalTime() rateWindowStart!: Date | null;
  @Int({ default: 0 }) rateWindowCalls!: number;
  @Fk(() => WorkspaceMembership, member("user_id"))
  owner!: Relation<WorkspaceMembership>;
  @Fk(() => WorkspaceMembership, member("revoked_by"), { nullable: true })
  revoker!: Relation<WorkspaceMembership> | null;
}
