import {
  Column,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type ColumnOptions,
  type ObjectType,
} from "typeorm";

/** Column helpers shared by every entity. */
export const schema = "nodrail";

// TypeORM reads a gen_random_uuid() default back as a generated column, so IDs
// must be declared as generated. A plain column with that default looks changed
// on every comparison. The function is built into PostgreSQL 13 and later.
export const Id = () => PrimaryGeneratedColumn("uuid");
export const Uuid = (options: ColumnOptions = {}) =>
  Column({ type: "uuid", ...options });
export const OptionalUuid = () => Column({ type: "uuid", nullable: true });
export const Text = (options: ColumnOptions = {}) =>
  Column({ type: "text", ...options });
export const OptionalText = () => Column({ type: "text", nullable: true });
export const Int = (options: ColumnOptions = {}) =>
  Column({ type: "integer", ...options });
export const Time = (options: ColumnOptions = {}) =>
  Column({ type: "timestamptz", ...options });
export const OptionalTime = () =>
  Column({ type: "timestamptz", nullable: true });
/**
 * Where an event sits in its run. One database sequence numbers every step and
 * action; with a run policy it is drawn while the run's row is locked, so
 * within a run it follows the order the events committed in. Read as text.
 */
export const OptionalSeq = () => Column({ type: "bigint", nullable: true });
export const CreatedAt = () => Time({ default: () => "now()" });
export const Clock = () => Time({ default: () => "clock_timestamp()" });
export const Json = (fallback: string) =>
  Column({ type: "jsonb", default: () => `'${fallback}'` });

export function Fk<T>(
  target: () => ObjectType<T>,
  joins: Record<string, string>,
  options: { nullable?: boolean } = {},
): PropertyDecorator {
  return (prototype, key) => {
    ManyToOne(target, {
      nullable: options.nullable ?? false,
      onDelete: "RESTRICT",
    })(prototype, key as string);
    JoinColumn(
      Object.entries(joins).map(([name, referencedColumnName]) => ({
        name,
        referencedColumnName,
      })),
    )(prototype, key as string);
  };
}

export const slugPattern = "'^[a-z0-9][a-z0-9-]{0,62}$'";
export const keyPattern = "'^[a-z0-9][a-z0-9_-]{0,62}$'";

export const inWorkspace = (column: string, referenced = "id") => ({
  workspace_id: "workspaceId",
  [column]: referenced,
});
/** A token used by this person: a token never acts for anyone else. */
export const tokenOf = (column: string, userColumn: string) => ({
  workspace_id: "workspaceId",
  [column]: "id",
  [userColumn]: "userId",
});
export const member = (column: string) => ({
  workspace_id: "workspaceId",
  [column]: "userId",
});
