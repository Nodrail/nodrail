import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/app/toast";
import type { TeamMemberDto } from "@/contracts/v1/team";
import { MemberActions } from "./member-actions";

vi.mock("../actions", () => ({
  changeRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}));

const member: TeamMemberDto = {
  userId: "u1",
  name: "Ana",
  email: "ana@example.test",
  role: "viewer",
  isOwner: false,
  isYou: false,
  assignedAgents: 0,
  canManage: false,
  canMakeOwner: false,
};

const show = (overrides: Partial<TeamMemberDto>) =>
  render(
    <ToastProvider>
      <MemberActions
        workspace="w"
        member={{ ...member, ...overrides }}
        assignableRoles={["policy_manager", "viewer"]}
      />
    </ToastProvider>,
  );

/** The names in Ana's "⋯" menu, once opened. */
async function menuItems() {
  await userEvent.click(
    screen.getByRole("button", { name: "Actions for Ana" }),
  );
  return (await screen.findAllByRole("menuitem")).map(
    (item) => item.textContent,
  );
}

describe("MemberActions", () => {
  test("offers nothing the server would refuse", async () => {
    show({});
    expect(await menuItems()).toEqual(["Copy email"]);
  });

  test("offers role changes and removal when allowed", async () => {
    show({ canManage: true });
    expect(await menuItems()).toEqual([
      "Change role…",
      "Copy email",
      "Remove…",
    ]);
  });

  test("offers ownership only when allowed", async () => {
    show({ canManage: true, canMakeOwner: true, role: "admin" });
    expect(await menuItems()).toContain("Make owner…");
  });

  test("a menu item opens its confirmation, with focus on Cancel", async () => {
    // As browsers do: the first control inside takes focus.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
      this.querySelector<HTMLElement>("button, select, input")?.focus();
    };
    show({ canManage: true });
    await menuItems();
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove…" }));
    const dialog = screen.getByRole("dialog", {
      name: "Remove Ana from this workspace?",
    });
    expect(dialog).toHaveAttribute("open");
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
  });

  test("the role list holds only roles this person may grant", () => {
    show({ canManage: true });
    const options = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#role-u1 option"),
    ).map((option) => option.value);
    expect(options).toEqual(["policy_manager", "viewer"]);
  });
});
