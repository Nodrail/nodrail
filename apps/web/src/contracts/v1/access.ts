export const roles = ["admin", "policy_manager", "viewer"] as const;
export type Role = (typeof roles)[number];

export const capabilities = [
  "workspace:read",
  "workspace:settings",
  "policies:write",
  "agents:manage",
  "members:manage",
  "ownership:manage",
] as const;
export type Capability = (typeof capabilities)[number];

const roleCapabilities: Record<Role, readonly Capability[]> = {
  viewer: ["workspace:read"],
  policy_manager: ["workspace:read", "policies:write"],
  admin: [
    "workspace:read",
    "workspace:settings",
    "policies:write",
    "agents:manage",
    "members:manage",
  ],
};

export function capabilitiesFor(role: Role, isOwner: boolean): Capability[] {
  const granted = [...roleCapabilities[role]];
  if (isOwner) granted.push("ownership:manage");
  return granted;
}

/** Viewers see only their assigned agents and their own actions. */
export function seesWholeWorkspace(role: Role): boolean {
  return role === "admin" || role === "policy_manager";
}
