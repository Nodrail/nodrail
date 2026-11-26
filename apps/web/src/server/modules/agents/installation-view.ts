import "server-only";
import { z } from "zod";
import {
  REPORTING_WINDOW_MINUTES,
  type AgentAccessDto,
  type InstallationDto,
  type Reporting,
} from "@/contracts/v1/agents";

export function reportingFor(
  lastSeenAt: Date | null,
  now = Date.now(),
): Reporting {
  if (!lastSeenAt) return "never_reported";
  return now - lastSeenAt.getTime() <= REPORTING_WINDOW_MINUTES * 60_000
    ? "reporting"
    : "stale";
}

export const accessColumns = {
  access_status: z.enum(["active", "paused"]),
  paused_at: z.date().nullable(),
  paused_by_name: z.string().nullable(),
};

const accessRow = z.object(accessColumns);

export function toAccess(row: z.infer<typeof accessRow>): AgentAccessDto {
  return {
    status: row.access_status,
    pausedAt: row.paused_at?.toISOString() ?? null,
    pausedBy: row.paused_by_name,
  };
}

const installationColumns = {
  installation_id: z.uuid(),
  installation_name: z.string(),
  environment_slug: z.string(),
  environment_name: z.string(),
  adapter_key: z.string(),
  adapter_version: z.string().nullable(),
  compatibility: z.enum(["unverified", "verified"]),
  last_seen_at: z.date().nullable(),
  disconnected: z.boolean(),
  machine_key: z.string().nullable(),
  machine_paused: z.boolean(),
  enrollment_project_id: z.uuid().nullable(),
};

export const installationRow = z.object(installationColumns);

export function toInstallation(
  row: z.infer<typeof installationRow>,
): InstallationDto {
  return {
    id: row.installation_id,
    disconnected: row.disconnected,
    machineKey: row.machine_key,
    machinePaused: row.machine_paused,
    name: row.installation_name,
    environment: { slug: row.environment_slug, name: row.environment_name },
    adapterKey: row.adapter_key,
    adapterVersion: row.adapter_version,
    compatibility: row.compatibility,
    reporting: reportingFor(row.disconnected ? null : row.last_seen_at),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
  };
}

export const disconnectedInstallation = `
  i.enrollment_project_id IS NOT NULL AND (i.enrollment_disabled_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM nodrail.installation_credentials c
    WHERE c.workspace_id = i.workspace_id AND c.installation_id = i.id AND c.revoked_at IS NULL
      AND (c.expires_at IS NULL OR c.expires_at > clock_timestamp())
  ))`;

export const installationSelect = `
  i.id AS installation_id, i.name AS installation_name,
  e.slug AS environment_slug, e.name AS environment_name,
  i.adapter_key, i.adapter_version, i.compatibility, i.last_seen_at, i.enrollment_project_id,
  CASE WHEN i.enrollment_project_id IS NOT NULL THEN machine.external_key END AS machine_key,
  machine.access_status = 'paused' AS machine_paused,
  (${disconnectedInstallation}) AS disconnected`;

export const installationOwner = `
  JOIN nodrail.agents machine ON machine.workspace_id = i.workspace_id AND machine.id = i.agent_id
  JOIN nodrail.environments e ON e.workspace_id = i.workspace_id AND e.id = i.environment_id`;

export const admittedAgent = `i.enrollment_project_id = a.managed_project_id
  AND a.external_key = ANY(i.enrollment_agent_keys)`;
