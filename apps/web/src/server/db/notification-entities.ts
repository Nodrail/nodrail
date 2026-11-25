import { Check, Entity, Index, Unique, type Relation } from "typeorm";
import {
  Clock,
  Fk,
  Id,
  Int,
  Json,
  OptionalText,
  OptionalTime,
  Text,
  Uuid,
  member,
  schema,
} from "./columns";
import { WorkspaceMembership } from "./entities";

/**
 * Notifications waiting to go out, in their own module: nothing else in the
 * schema references them. Every export here is a table (see options.ts).
 */

const notificationKinds = "'integration_stale', 'usage_alert'";

/** Written with its event. Delivery can fail or repeat and grants nothing. */
@Entity({ schema, name: "notification_outbox" })
@Unique(["workspaceId", "dedupeKey"])
@Index("notification_outbox_due", ["state", "availableAt"])
@Check("notification_kind", `"kind" IN (${notificationKinds})`)
@Check(
  "notification_state",
  `"state" IN ('pending', 'sending', 'delivered', 'failed', 'dropped')`,
)
@Check("notification_channel", `"channel" = 'email'`)
@Check("notification_attempts", `"attempts" >= 0`)
@Check("notification_payload", `pg_column_size("payload_safe") <= 4096`)
export class NotificationOutbox {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Text() kind!: string;
  @Text({ default: "email" }) channel!: string;
  @Uuid() recipientUserId!: string;
  @Text() recipientEmail!: string;
  @Json("{}") payloadSafe!: object;
  @Text() dedupeKey!: string;
  @Text({ default: "pending" }) state!: string;
  @Int({ default: 0 }) attempts!: number;
  @Clock() availableAt!: Date;
  @OptionalTime() leaseUntil!: Date | null;
  @OptionalTime() deliveredAt!: Date | null;
  @OptionalText() lastError!: string | null;
  @Clock() createdAt!: Date;
  @Fk(() => WorkspaceMembership, member("recipient_user_id"))
  recipient!: Relation<WorkspaceMembership>;
}
