import { z } from "zod";

/** How long after the last check-in an installation still counts as reporting. */
export const REPORTING_WINDOW_MINUTES = 30;

/** Runtimes offered in setup. Availability still depends on a tested adapter. */
export const adapters = [
  {
    key: "claude-code-hook",
    label: "Claude Code",
    detail: "Plugin · needs Claude Code 2.1.295 or later",
  },
  {
    key: "codex-hook",
    label: "Codex",
    detail: "Plugin · needs Codex 0.155 or later",
  },
  {
    key: "custom-sdk",
    label: "TypeScript SDK",
    detail: "LangChain, Vercel AI SDK, OpenAI Agents and others · one line",
  },
] as const;

export type AdapterKey = (typeof adapters)[number]["key"];

const adapterKeys = adapters.map((adapter) => adapter.key) as [
  AdapterKey,
  ...AdapterKey[],
];

export function adapterLabel(key: string) {
  return adapters.find((adapter) => adapter.key === key)?.label ?? key;
}

export const connectAgentInput = z
  .object({
    agentKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{0,57}$/),
    description: z
      .string()
      .trim()
      .max(200)
      .transform((value) => value || null),
    environmentSlug: z.string().min(1).max(63),
    adapterKey: z.enum(adapterKeys),
  })
  .strict();

export type Reporting = "reporting" | "stale" | "never_reported";

export type ObservedOutcome =
  "allowed_by_rule" | "denied_by_rule" | "unknown_blocked" | "observed_only";

export type CredentialDto = {
  id: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

/** The only response that ever carries a secret. It cannot be fetched again. */
export type IssuedCredentialDto = {
  id: string;
  prefix: string;
  secret: string;
};

export type AgentAccessDto = {
  status: "active" | "paused";
  pausedAt: string | null;
  pausedBy: string | null;
};

export type InstallationDto = {
  id: string;
  name: string;
  environment: { slug: string; name: string };
  adapterKey: string;
  adapterVersion: string | null;
  compatibility: "unverified" | "verified";
  reporting: Reporting;
  lastSeenAt: string | null;
};

export type AgentListItemDto = {
  key: string;
  description: string | null;
  access: AgentAccessDto;
  installation: InstallationDto;
  tools: string[];
};

export type AgentListDto = {
  items: AgentListItemDto[];
  nextCursor: string | null;
  summary: { connected: number; reporting: number; paused: number };
};

export type ObservedActionDto = {
  installationName: string;
  toolKey: string;
  operationKey: string;
  resourceKind: string;
  resource: string;
  outcome: ObservedOutcome;
  attempts: number;
  lastSeenAt: string;
};

export type AgentDetailDto = {
  key: string;
  description: string | null;
  access: AgentAccessDto;
  /** Credentials are present only for people who can manage agents. */
  installations: (InstallationDto & { credentials?: CredentialDto[] })[];
  tools: string[];
  observedActions: ObservedActionDto[];
  canManage: boolean;
};

export type AgentOptionDto = { key: string; installationName: string | null };

export type ConnectedAgentDto = {
  agentKey: string;
  installationName: string;
  adapterKey: AdapterKey;
  credential: IssuedCredentialDto;
};

/** A newly connected agent's first check-in, and the setup checks it shows. */
export type CheckInDto = {
  /** Null until its integration first reaches Nodrail here. */
  lastSeenAt: string | null;
  checks: {
    /** A rule allowed one of its actions and a permit was issued. */
    allowed: boolean;
    /** An action no rule covered was denied. */
    blocked: boolean;
    /** A rule denied one of its actions. */
    denied: boolean;
  };
};

export type AccessChangeDto = { status: "active" | "paused" };
