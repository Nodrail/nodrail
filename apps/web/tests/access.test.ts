import { describe, expect, test } from "vitest";
import {
  capabilitiesFor,
  roles,
  seesWholeWorkspace,
  type Capability,
  type Role,
} from "@/contracts/v1/access";

const allowed: Record<Capability, Role[]> = {
  "workspace:read": ["admin", "policy_manager", "viewer"],
  "workspace:settings": ["admin"],
  "policies:write": ["admin", "policy_manager"],
  "projects:apply": ["admin", "policy_manager"],
  "agents:manage": ["admin"],
  "members:manage": ["admin"],
  "ownership:manage": [],
};

describe("access matrix", () => {
  test.each(Object.entries(allowed))("%s", (capability, permitted) => {
    for (const role of roles)
      expect(
        capabilitiesFor(role, false).includes(capability as Capability),
      ).toBe(permitted.includes(role));
  });

  test("only the owner manages ownership", () => {
    expect(capabilitiesFor("admin", true)).toContain("ownership:manage");
    expect(capabilitiesFor("admin", false)).not.toContain("ownership:manage");
  });

  test("there is no role or capability for approving", () => {
    expect(roles).toEqual(["admin", "policy_manager", "viewer"]);
    for (const role of roles)
      expect(capabilitiesFor(role, true).join(" ")).not.toMatch(/approv/);
  });

  test("whole-workspace visibility", () => {
    expect(seesWholeWorkspace("admin")).toBe(true);
    expect(seesWholeWorkspace("policy_manager")).toBe(true);
    expect(seesWholeWorkspace("viewer")).toBe(false);
  });
});
