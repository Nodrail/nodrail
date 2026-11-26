import { z } from "zod";
import type { Capability } from "./access";

/**
 * What a personal access token may be used for. `read` is always included,
 * but for a reporting token. `rules:write` lets whoever holds the token act
 * as its person, so it is chosen on its own and never on by default. `inventory:write`
 * is a token of its own that only reports the person's own machines, for
 * the team's inventory: it reads nothing, since it sits where agents run.
 */
export const apiTokenScopes = [
  "read",
  "rules:write",
  "agents:manage",
  "members:manage",
  "workspace:settings",
  "inventory:write",
] as const;
export type ApiTokenScope = (typeof apiTokenScopes)[number];

/**
 * Each scope opens one capability. A token's capabilities are its scopes'
 * capabilities that its person's role grants at the moment of the call.
 */
export const scopeCapability: Record<ApiTokenScope, Capability> = {
  read: "workspace:read",
  "rules:write": "policies:write",
  "agents:manage": "agents:manage",
  "members:manage": "members:manage",
  "workspace:settings": "workspace:settings",
  // Anyone may report their own machines.
  "inventory:write": "workspace:read",
};

export function capabilitiesForToken(scopes: ApiTokenScope[]) {
  const allowed = new Set(scopes.map((scope) => scopeCapability[scope]));
  if (scopes.includes("rules:write")) allowed.add("projects:apply");
  return allowed;
}

export const apiTokenExpiries = [30, 90, 365, 0] as const;
/** In days; 0 means the token never expires. */
export type ApiTokenExpiry = (typeof apiTokenExpiries)[number];
export const DEFAULT_TOKEN_EXPIRY_DAYS = 90;

/** Live tokens one person may hold in one workspace. */
export const MAX_LIVE_TOKENS = 20;

/** Requests one token may make in a minute. */
export const API_CALLS_PER_MINUTE = 120;

/** A rules file plus its JSON wrapping. */
export const MAX_API_BODY_BYTES = 256 * 1024 + 4 * 1024;

export const createApiTokenInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z
      .array(z.enum(apiTokenScopes))
      .max(apiTokenScopes.length)
      .refine(
        (scopes) => !scopes.includes("inventory:write") || scopes.length === 1,
        "inventory:write is a token of its own",
      )
      // A reporting token reads nothing: it sits where agents run.
      .transform((scopes) =>
        scopes.includes("inventory:write")
          ? (["inventory:write"] as ApiTokenScope[])
          : [...new Set<ApiTokenScope>(["read", ...scopes])],
      ),
    expiresInDays: z.coerce
      .number()
      .refine((days): days is ApiTokenExpiry =>
        (apiTokenExpiries as readonly number[]).includes(days),
      ),
  })
  .strict();

export type ApiTokenDto = {
  id: string;
  name: string;
  /** The public part, `ndp_` and 12 hex characters, safe to show. */
  prefix: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Whose token it is; admins see everyone's. */
  owner: string;
  mine: boolean;
};

export type IssuedApiTokenDto = { token: ApiTokenDto; secret: string };

export type ApiTokenListDto = {
  tokens: ApiTokenDto[];
  /** The scopes this person's role lets a new token use. */
  grantable: ApiTokenScope[];
  /** Admins can revoke anyone's tokens. */
  seesEveryone: boolean;
};

/** One sentence for each scope a person turns on, shown where they choose it. */
export const scopeRisks: Record<Exclude<ApiTokenScope, "read">, string> = {
  "rules:write":
    "This token can publish rules and enroll machines for locked projects the token owner may apply. Keep it away from governed agents.",
  "agents:manage": "This token can issue runtime credentials and pause agents.",
  "members:manage": "This token can invite, remove and assign teammates.",
  "workspace:settings":
    "This token can change workspace settings and export workspace data.",
  "inventory:write":
    "Choose it alone: such a token reads nothing and only reports machines as yours. It goes in your project's telemetry settings, where agents run.",
};

export const scopeLabels: Record<ApiTokenScope, string> = {
  read: "Read workspace control-plane data",
  "rules:write": "Preview and publish rules and apply locked projects",
  "agents:manage": "Manage agents and runtime credentials",
  "members:manage": "Manage teammates, invites and assignments",
  "workspace:settings": "Manage workspace settings and export data",
  "inventory:write": "Report your machines' setups to the team's inventory",
};
