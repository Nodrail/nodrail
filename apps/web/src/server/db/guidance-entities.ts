import { Check, Entity, PrimaryColumn, type Relation } from "typeorm";
import { Clock, Fk, OptionalText, schema } from "./columns";
import { User } from "./entities";

/**
 * What one person has seen of the product's guidance: a tour, the first-steps
 * list of a workspace, the last "What's new" entry. Their own rows only.
 */
@Entity({ schema, name: "user_guidance" })
@Check("user_guidance_key", `"key" ~ '^[a-z][a-z0-9_:-]{0,99}$'`)
@Check("user_guidance_value", `length("value") <= 100`)
export class UserGuidance {
  @PrimaryColumn({ type: "uuid" }) userId!: string;
  @PrimaryColumn({ type: "text" }) key!: string;
  /** For keys that remember a choice, such as the last entry read. */
  @OptionalText() value!: string | null;
  @Clock() seenAt!: Date;
  @Fk(() => User, { user_id: "id" }) user!: Relation<User>;
}
