import { Entity, Index, PrimaryColumn, Unique, type Relation } from "typeorm";
import {
  Fk,
  Int,
  OptionalText,
  OptionalTime,
  OptionalUuid,
  schema,
  Text,
  Time,
} from "./columns";
import { User } from "./entities";

@Entity({ schema, name: "login_accounts" })
@Unique("login_accounts_email", ["email"])
export class LoginAccount {
  @PrimaryColumn("uuid") userId!: string;
  @Text() email!: string;
  @OptionalText() passwordHash!: string | null;
  @OptionalTime() emailVerifiedAt!: Date | null;
  @Fk(() => User, { user_id: "id" }) user!: Relation<User>;
}

export type LoginLinkKind = "sign-in" | "verify" | "reset";

@Entity({ schema, name: "login_links" })
@Index("login_links_expiry", ["expiresAt"])
@Index("login_links_email", ["email"])
export class LoginLink {
  @PrimaryColumn("text") digest!: string;
  @Text() email!: string;
  @OptionalUuid() userId!: string | null;
  @Text() kind!: LoginLinkKind;
  @Time() expiresAt!: Date;
  @Fk(() => User, { user_id: "id" }, { nullable: true })
  user!: Relation<User> | null;
}

@Entity({ schema, name: "login_rate_windows" })
@Index("login_rate_windows_expiry", ["expiresAt"])
export class LoginRateWindow {
  @PrimaryColumn("text") key!: string;
  @Time() expiresAt!: Date;
  @Int() attempts!: number;
}

@Entity({ schema, name: "cli_login_requests" })
@Index("cli_login_requests_expiry", ["expiresAt"])
export class CliLoginRequest {
  @PrimaryColumn("text") challenge!: string;
  @Text() origin!: string;
  @Time() expiresAt!: Date;
  @OptionalUuid() userId!: string | null;
  @Fk(() => User, { user_id: "id" }, { nullable: true })
  user!: Relation<User> | null;
}
