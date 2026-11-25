/**
 * What a host's credential may ask the control plane for, beyond the
 * runtime API it always had: the published policy, recording the
 * calls it decided, reserving shared budgets and reading
 * verified evidence. The migration DataPlaneScopes grants them to existing
 * credentials; new ones get them from RUNTIME_SCOPES.
 */
export const DATA_PLANE_SCOPES = [
  "policy:read",
  "decisions:write",
  "budgets:reserve",
  "evidence:read",
] as const;

/** Everything a credential made for an agent may do. */
export const RUNTIME_SCOPES = [
  "actions:submit",
  "actions:read-own",
  "permits:request",
  "reports:write-own",
  "heartbeat:write",
  ...DATA_PLANE_SCOPES,
];
