import "server-only";
import { DataSource, type EntityManager } from "typeorm";
import {
  capabilitiesFor,
  type Capability,
  type Role,
} from "@/contracts/v1/access";
import { dataSourceOptions } from "./options";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INSUFFICIENT_SCOPE"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "ALREADY_EXISTS"
  | "RULE_LIMIT_REACHED"
  | "REPOSITORY_CHANGED"
  | "RULE_CHANGED"
  | "ACTION_CHANGED"
  | "DECISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "PERMIT_ALREADY_ISSUED"
  | "DECIDED_ON_HOST"
  | "RUN_TOO_LONG"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "BILLING_ACTIVE"
  | "OWNS_WORKSPACE"
  | "VERSION_NOT_RENDERABLE"
  | "BUSY";

const statusFor: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  // The person may, but the API token they used was not given this scope.
  INSUFFICIENT_SCOPE: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 422,
  ALREADY_EXISTS: 409,
  RULE_LIMIT_REACHED: 409,
  REPOSITORY_CHANGED: 409,
  RULE_CHANGED: 409,
  ACTION_CHANGED: 409,
  DECISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PERMIT_ALREADY_ISSUED: 409,
  // The hook decided it on its host: Cloud records it and never permits it.
  DECIDED_ON_HOST: 409,
  // The request is fine; the run's history is past what one decision reads.
  RUN_TOO_LONG: 409,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 402,
  BILLING_ACTIVE: 409,
  OWNS_WORKSPACE: 409,
  // The live version can't be written back as YAML yet (document version 4).
  VERSION_NOT_RENDERABLE: 409,
  BUSY: 503,
};

export class AppError extends Error {
  readonly status: number;
  /** `detail`: safe words for the caller, sent as the error's `message`. */
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.status = statusFor[code];
  }
}

/** A pause denial that must commit its redacted decision before the API returns 403. */
export class RecordedAccessDenial extends AppError {
  constructor(detail: string) {
    super("FORBIDDEN", detail);
  }
}

export type HumanPrincipal = { userId: string; sessionId: string };

/** A person acting through one of their personal API tokens. */
export type TokenPrincipal = {
  userId: string;
  tokenId: string;
  tokenName: string;
};

/** Who a workspace change is made by: a person, in a browser or with a token. */
export type ActingPrincipal = HumanPrincipal | TokenPrincipal;

export type UserContext = {
  manager: EntityManager;
  principal: HumanPrincipal;
};

export type WorkspaceContext = {
  manager: EntityManager;
  principal: ActingPrincipal;
  workspaceId: string;
  role: Role;
  isOwner: boolean;
  capabilities: ReadonlySet<Capability>;
};

/**
 * Deliberately per module copy: a DataSource recognises entities by class
 * identity. Concurrent requests in the same copy share a connection attempt.
 */
function sourceFor(key: "DATABASE_URL" | "AUTH_DATABASE_URL") {
  let source: Promise<DataSource> | undefined;
  async function connect() {
    const url = process.env[key];
    if (!url) throw new Error(`${key} missing`);
    const options = dataSourceOptions(url);
    return new DataSource(
      key === "AUTH_DATABASE_URL"
        ? { ...options, entities: [], poolSize: 3 }
        : options,
    ).initialize();
  }
  return () =>
    (source ??= connect().catch((error: unknown) => {
      source = undefined;
      throw error;
    }));
}

const getDataSource = sourceFor("DATABASE_URL");
const getAuthSource = sourceFor("AUTH_DATABASE_URL");

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function translate(error: unknown): unknown {
  const { code, driverError } = error as {
    code?: string;
    driverError?: { code?: string };
  };
  const sqlState = driverError?.code ?? code;
  if (sqlState === "55P03" || sqlState === "40P01" || sqlState === "40001")
    return new AppError("BUSY");
  if (sqlState === "23505") return new AppError("ALREADY_EXISTS");
  return error;
}

/**
 * One transaction on one connection, with tenant settings scoped to it. Only
 * the db/ context modules call it; use cases get a context instead.
 */
export async function transaction<T>(
  settings: { userId?: string; workspaceId?: string },
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return scopedTransaction(getDataSource, settings, run);
}

async function scopedTransaction<T>(
  source: () => Promise<DataSource>,
  settings: { userId?: string; workspaceId?: string },
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const dataSource = await source();
  try {
    return await dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT set_config('nodrail.user_id', $1, true),
                set_config('nodrail.workspace_id', $2, true),
                set_config('lock_timeout', '3s', true),
                set_config('statement_timeout', '5s', true)`,
        [settings.userId ?? "", settings.workspaceId ?? ""],
      );
      return run(manager);
    });
  } catch (error) {
    throw translate(error);
  }
}

async function assertSession(
  manager: EntityManager,
  principal: HumanPrincipal,
) {
  const rows: unknown[] = await manager.query(
    `SELECT 1 FROM nodrail.human_sessions s
     JOIN nodrail.users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
       AND s.expires_at > clock_timestamp() AND u.status = 'active'
     FOR SHARE OF s`,
    [principal.sessionId, principal.userId],
  );
  if (rows.length === 0) throw new AppError("UNAUTHENTICATED");
}

/** Live membership and role, held until the transaction ends. */
export async function memberContext(
  manager: EntityManager,
  principal: ActingPrincipal,
  workspaceId: string,
): Promise<WorkspaceContext> {
  const [member]: { role: Role; is_owner: boolean }[] = await manager.query(
    `SELECT m.role, m.is_owner
     FROM nodrail.workspace_memberships m
     JOIN nodrail.workspaces w ON w.id = m.workspace_id
     WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'
       AND w.archived_at IS NULL
     FOR SHARE OF m`,
    [workspaceId, principal.userId],
  );
  if (!member) throw new AppError("NOT_FOUND");
  const isOwner = member.is_owner;
  return {
    manager,
    principal,
    workspaceId,
    role: member.role,
    isOwner,
    capabilities: new Set(capabilitiesFor(member.role, isOwner)),
  };
}

async function buildContext(
  manager: EntityManager,
  principal: HumanPrincipal,
  workspaceId: string,
): Promise<WorkspaceContext> {
  await assertSession(manager, principal);
  return memberContext(manager, principal, workspaceId);
}

/** A transaction before a user or workspace can be identified. */
export function beforeAuthentication<T>(
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return transaction({}, run);
}

/** A separate role sees login state before any user or workspace is known. */
export function asAuthenticator<T>(
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return scopedTransaction(getAuthSource, {}, run);
}

/** Creating a workspace: the session is real, the membership does not exist yet. */
export function inNewWorkspace<T>(
  principal: HumanPrincipal,
  workspaceId: string,
  run: (context: UserContext) => Promise<T>,
): Promise<T> {
  return transaction(
    { userId: principal.userId, workspaceId },
    async (manager) => {
      await assertSession(manager, principal);
      return run({ manager, principal });
    },
  );
}

/** For work before a workspace is chosen, such as listing memberships. */
export function withUser<T>(
  principal: HumanPrincipal,
  run: (context: UserContext) => Promise<T>,
): Promise<T> {
  return transaction({ userId: principal.userId }, async (manager) => {
    await assertSession(manager, principal);
    return run({ manager, principal });
  });
}

function enterWorkspace<T>(
  principal: HumanPrincipal,
  workspaceId: string,
  run: (context: WorkspaceContext) => Promise<T>,
  prepare?: (manager: EntityManager) => Promise<unknown>,
): Promise<T> {
  if (!uuidPattern.test(workspaceId))
    return Promise.reject(new AppError("NOT_FOUND"));
  return transaction(
    { userId: principal.userId, workspaceId },
    async (manager) => {
      const context = await buildContext(manager, principal, workspaceId);
      await prepare?.(manager);
      return run(context);
    },
  );
}

/**
 * For changes and security steps. Sees the whole workspace, because a rule or
 * pause must reach every request, so each use case checks capabilities first.
 * The workspace in a URL is only a request until live membership confirms it.
 */
export function withWorkspace<T>(
  principal: HumanPrincipal,
  workspaceId: string,
  run: (context: WorkspaceContext) => Promise<T>,
): Promise<T> {
  return enterWorkspace(principal, workspaceId, run);
}

/** For screens. The database limits rows to what this person may see. */
export function readWorkspace<T>(
  principal: HumanPrincipal,
  workspaceId: string,
  run: (context: WorkspaceContext) => Promise<T>,
): Promise<T> {
  return enterWorkspace(principal, workspaceId, run, (manager) =>
    manager.query("SET LOCAL ROLE nodrail_member_read"),
  );
}

/**
 * For the delivery process. This role can read the outbox and workspace IDs and
 * nothing else, so a bug here cannot reach decisions or policies.
 */
export function asNotifier<T>(
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return transaction({}, async (manager) => {
    await manager.query("SET LOCAL ROLE nodrail_notifier");
    return run(manager);
  });
}

/** For retention and erasure: the only role that can rewrite old records. */
export function asMaintenance<T>(
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return transaction({}, async (manager) => {
    await manager.query("SET LOCAL ROLE nodrail_maintenance");
    return run(manager);
  });
}

/** Scheduled work for one workspace, with no person or credential behind it. */
export function asSystem<T>(
  workspaceId: string,
  run: (scope: { manager: EntityManager; workspaceId: string }) => Promise<T>,
): Promise<T> {
  return transaction({ workspaceId }, (manager) =>
    run({ manager, workspaceId }),
  );
}

export {
  withRuntime,
  type RuntimeContext,
  type RuntimeScope,
} from "./runtime-context";

/** Every use case validates its input the same way. */
export function parseInput<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_INPUT");
  return parsed.data as T;
}

/** Raw rows are loosely typed, so read models are checked against a schema. */
export function parseRows<T>(
  schema: { parse(value: unknown): T },
  rows: unknown[],
): T[] {
  return rows.map((row) => schema.parse(row));
}

/** The workspace a public prefix belongs to, before any tenant is known. */
export async function workspaceForPrefix(
  lookup: "workspace_for_credential" | "workspace_for_personal_token",
  prefix: string,
) {
  return transaction({}, async (manager) => {
    const [row]: { id: string | null }[] = await manager.query(
      `SELECT nodrail.${lookup}($1) AS id`,
      [prefix],
    );
    return row?.id ?? null;
  });
}

export function encodeCursor(at: string, id: string) {
  return Buffer.from(`${at}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string | undefined) {
  if (!cursor) return { at: null, id: null };
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || !uuidPattern.test(id) || Number.isNaN(Date.parse(at)))
    throw new AppError("INVALID_INPUT");
  return { at, id };
}

export function requireCapability(
  context: WorkspaceContext,
  capability: Capability,
) {
  if (!context.capabilities.has(capability)) throw new AppError("FORBIDDEN");
}
