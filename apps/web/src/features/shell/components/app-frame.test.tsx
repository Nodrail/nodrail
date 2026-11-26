import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { AppFrame, initials } from "./app-frame";

let pathname = "/app/acme/development/agents";
let search = "";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/features/auth/actions", () => ({ signOut: vi.fn() }));

const view: WorkspaceViewDto = {
  id: "w1",
  name: "Acme Studio",
  slug: "acme",
  role: "viewer",
  isOwner: false,
  capabilities: ["workspace:read"],
  environments: [
    { id: "e1", slug: "development", name: "Development" },
    { id: "e2", slug: "production", name: "Production" },
  ],
  defaultEnvironmentId: "e1",
  otherWorkspaces: [{ id: "w2", name: "Beta", slug: "beta", role: "viewer" }],
  person: { id: "u1", name: "alex", email: "alex@example.test" },
};

const workspaceMenu = () =>
  document.querySelector("[data-slot=workspace-menu]") as HTMLElement;

let phone = false;

function mockMedia() {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: phone,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderFrame(
  workspace: WorkspaceViewDto = view,
  { collapsed = false, environment = "development", showBilling = true } = {},
) {
  render(
    <AppFrame
      view={workspace}
      environmentSlug={environment}
      initialCollapsed={collapsed}
      showBilling={showBilling}
      plan={
        showBilling
          ? {
              plan: "Free",
              percent: workspace.capabilities.includes("workspace:settings")
                ? 42
                : null,
            }
          : null
      }
    >
      <p>Page body</p>
    </AppFrame>,
  );
}

describe("AppFrame", () => {
  beforeEach(() => {
    pathname = "/app/acme/development/agents";
    phone = false;
    search = "";
    document.cookie = "nodrail.environment.acme=; max-age=0; path=/";
    document.cookie = "nodrail.sidebar=; max-age=0; path=/";
    mockMedia();
    // The rail's labels are Radix tooltips, which measure themselves.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  test("links every section under the current environment", () => {
    renderFrame();
    expect(screen.getByRole("link", { name: "Policies" })).toHaveAttribute(
      "href",
      "/app/acme/development/policies",
    );
    expect(screen.queryByRole("link", { name: "Team" })).toBeNull();
  });

  test("preserves the Activity view and shared filters when switching environments", () => {
    pathname = "/app/acme/development/activity";
    search = "view=runs&range=7d&agent=support&event=123&cursor=abc";
    renderFrame();
    expect(
      within(workspaceMenu()).getByRole("link", { name: "Production" }),
    ).toHaveAttribute(
      "href",
      "/app/acme/production/activity?view=runs&range=7d",
    );
  });

  test("uses the last environment for account navigation", () => {
    pathname = "/app/acme/account/tokens";
    document.cookie = "nodrail.environment.acme=production; path=/";
    renderFrame();
    expect(screen.getByRole("link", { name: "Policies" })).toHaveAttribute(
      "href",
      "/app/acme/production/policies",
    );
  });

  test("puts the workspace's settings in its menu, billing only for who manages it", () => {
    renderFrame();
    const menu = within(workspaceMenu());
    expect(menu.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/app/acme/settings/general",
    );
    expect(menu.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/app/acme/settings/members",
    );
    expect(menu.queryByRole("link", { name: /Billing/ })).toBeNull();
    expect(menu.getByText("Free")).toBeInTheDocument();
  });

  test("shows how much of the plan is used next to Billing", () => {
    renderFrame({
      ...view,
      role: "admin",
      capabilities: ["workspace:read", "workspace:settings"],
    });
    expect(
      within(workspaceMenu()).getByRole("link", { name: /Billing & usage/ }),
    ).toHaveTextContent("42% used");
  });

  test("keeps billing out of the self-hosted workspace menu", () => {
    renderFrame(
      { ...view, capabilities: ["workspace:read", "workspace:settings"] },
      { showBilling: false },
    );
    const menu = within(workspaceMenu());
    expect(menu.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(menu.queryByRole("link", { name: /Billing/ })).toBeNull();
    expect(menu.queryByText("Free")).toBeNull();
  });

  test("puts your own pages in the account menu", () => {
    renderFrame();
    const menu = within(
      document.querySelector("[data-slot=account-menu]") as HTMLElement,
    );
    for (const [name, href] of [
      ["Notifications", "/app/acme/account/notifications"],
      ["API tokens", "/app/acme/account/tokens"],
      ["Privacy & your data", "/app/acme/account/privacy"],
    ])
      expect(menu.getByRole("link", { name })).toHaveAttribute("href", href);
  });

  test("on a settings page, the sidebar works in the environment it was given", () => {
    pathname = "/app/acme/settings/members";
    renderFrame();
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/app/acme/development/agents",
    );
    expect(screen.getByRole("link", { name: "Production" })).toHaveAttribute(
      "href",
      "/app/acme/production/overview",
    );
    expect(
      within(workspaceMenu()).getByRole("link", { name: "Members" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("marks only the current section", () => {
    renderFrame();
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("keeps the section when offering another environment", () => {
    renderFrame();
    expect(screen.getByRole("link", { name: "Production" })).toHaveAttribute(
      "href",
      "/app/acme/production/agents",
    );
  });

  test("lists the person's other workspaces", () => {
    renderFrame();
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute(
      "href",
      "/app/beta",
    );
  });

  test("shows the role, not ownership, for a member", () => {
    renderFrame();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  test("opens with names on wide screens, and remembers a collapse", async () => {
    renderFrame();
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    );
    expect(document.cookie).toContain("nodrail.sidebar=collapsed");
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("the collapsed rail names a link beside it on keyboard focus", async () => {
    renderFrame(view, { collapsed: true });
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Overview");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("the phone drawer is a modal that gives focus back", async () => {
    phone = true;
    renderFrame();
    const toggle = screen.getByRole("button", { name: "Expand sidebar" });
    await userEvent.click(toggle);
    const drawer = screen.getByRole("dialog", { name: "Workspace navigation" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("link", { name: "Agents" })).toHaveFocus();
    expect(document.getElementById("page")?.closest("[inert]")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    await userEvent.click(
      screen.getByRole("button", { name: "Close navigation" }),
    );
    expect(toggle).toHaveFocus();
    expect(document.getElementById("page")?.closest("[inert]")).toBeNull();
  });

  test("shows the environment, Production in the warning tone", () => {
    renderFrame(view, { environment: "production" });
    const chip = document.querySelector("[data-slot=environment-context]");
    expect(chip).toHaveTextContent("Production");
    expect(chip?.querySelector("[data-slot=status-badge]")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });

  test("a menu closes when focus moves outside it", async () => {
    renderFrame();
    const menu = workspaceMenu() as HTMLDetailsElement;
    await userEvent.click(menu.querySelector("summary") as HTMLElement);
    expect(menu.open).toBe(true);
    within(menu).getByRole("link", { name: "Members" }).focus();
    expect(menu.open).toBe(true);
    screen.getByRole("button", { name: "Collapse sidebar" }).focus();
    expect(menu.open).toBe(false);
  });
});

describe("initials", () => {
  test.each([
    ["Jordan Davis", "JD"],
    ["alex", "AL"],
    ["maya.chen", "MC"],
    ["  sam   rivera  jones", "SR"],
    ["", ""],
  ])("%j becomes %j", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
