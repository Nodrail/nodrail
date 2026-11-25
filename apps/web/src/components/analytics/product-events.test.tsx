import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { ConnectAgentForm } from "@/features/agents/components/connect-agent-form";
import { ExportRulesLink } from "@/features/policies/components/export-rules-link";
import { InvitePanel } from "@/features/team/components/invite-panel";
import { CreateWorkspaceForm } from "@/features/workspaces/components/create-workspace-form";
import { ToastProvider } from "@/components/app/toast";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  push: vi.fn(),
  requestSignInLink: vi.fn(),
  createWorkspaceAction: vi.fn(),
  connectAgentAction: vi.fn(),
  inviteAction: vi.fn(),
}));

vi.mock("@/components/analytics/posthog", () => ({ track: mocks.track }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/app/acme/prod/activity",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/auth/actions", () => ({
  requestSignInLink: mocks.requestSignInLink,
}));
vi.mock("@/features/workspaces/actions", () => ({
  createWorkspaceAction: mocks.createWorkspaceAction,
}));
vi.mock("@/features/agents/actions", () => ({
  connectAgentAction: mocks.connectAgentAction,
}));
vi.mock("@/features/team/actions", () => ({
  inviteAction: mocks.inviteAction,
}));

const click = (name: string) =>
  userEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

describe("sign-in requested", () => {
  test("fires only when the link was sent, with no email", async () => {
    mocks.requestSignInLink.mockResolvedValue({ status: "sent" });
    render(<SignInForm next="/app" submitLabel="Send" />);
    await userEvent.type(
      screen.getByLabelText("Email"),
      "someone@example.test",
    );
    await click("Send");
    await waitFor(() =>
      expect(mocks.track.mock.calls).toEqual([["sign_in_requested"]]),
    );
  });

  test("does not fire when refused", async () => {
    mocks.requestSignInLink.mockResolvedValue({ status: "unavailable" });
    render(<SignInForm next="/app" submitLabel="Send" />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.test");
    await click("Send");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

describe("workspace created", () => {
  test("sends only the id, then goes to the workspace", async () => {
    mocks.createWorkspaceAction.mockResolvedValue({
      status: "created",
      slug: "secret-name",
      workspaceId: "w-id",
    });
    render(<CreateWorkspaceForm />);
    await userEvent.type(screen.getByLabelText("Workspace name"), "Secret");
    await click("Create workspace");
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/app/secret-name"),
    );
    expect(mocks.track.mock.calls).toEqual([
      ["workspace_created", { workspace_id: "w-id" }],
    ]);
  });

  test("does not fire on a refused name", async () => {
    mocks.createWorkspaceAction.mockResolvedValue({ status: "invalid" });
    render(<CreateWorkspaceForm />);
    await userEvent.type(screen.getByLabelText("Workspace name"), "x");
    await click("Create workspace");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

test("agent connected sends the runtime type, not the agent", async () => {
  mocks.connectAgentAction.mockResolvedValue({
    status: "ok",
    data: {
      agentKey: "secret-agent",
      installationName: "secret-install",
      adapterKey: "custom-sdk",
      credential: { secret: "ndr_secret" },
    },
  });
  render(
    <ToastProvider>
      <ConnectAgentForm
        workspace="acme"
        environmentSlug="prod"
        environmentName="Prod"
        agentsPath="/agents"
        serverUrl="https://nodrail.test"
        initialKey="secret-agent"
      />
    </ToastProvider>,
  );
  await click("Connect agent");
  await waitFor(() => expect(mocks.track).toHaveBeenCalledOnce());
  expect(mocks.track.mock.calls).toEqual([
    ["agent_connected", { adapter: "custom-sdk" }],
  ]);
});

test("an invite records the event without the link or email", async () => {
  mocks.inviteAction.mockResolvedValue({
    status: "ok",
    message: "Invite sent.",
    data: { url: "https://nodrail.test/invite/secret", emailed: true },
  });
  render(
    <ToastProvider>
      <InvitePanel workspace="acme" />
    </ToastProvider>,
  );
  await click("Invite teammate");
  await userEvent.type(screen.getByLabelText("Email"), "a@b.test");
  await click("Create invite link");
  await waitFor(() => expect(mocks.track).toHaveBeenCalledOnce());
  expect(mocks.track.mock.calls).toEqual([["teammate_invited"]]);
});

describe("rules export", () => {
  const show = () =>
    render(
      <ToastProvider>
        <ExportRulesLink href="/export" />
      </ToastProvider>,
    );

  test("fires after the file came back and was saved", async () => {
    const saved = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("rules: []", {
          headers: {
            "content-disposition": 'attachment; filename="rules.yaml"',
          },
        }),
      ),
    );
    show();
    fireExport();
    await waitFor(() => expect(mocks.track).toHaveBeenCalledOnce());
    expect(mocks.track.mock.calls).toEqual([["yaml_exported"]]);
    expect(saved).toHaveBeenCalled();
  });

  test.each([
    ["a failed response", new Response("no", { status: 500 })],
    ["a sign-in page", new Response("<html>")],
  ])("records nothing for %s", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    show();
    fireExport();
    await waitFor(() =>
      expect(
        screen.getByText("We could not export the rules. Please try again."),
      ).toBeInTheDocument(),
    );
    expect(mocks.track).not.toHaveBeenCalled();
  });
});

function fireExport() {
  fireEvent.click(screen.getByText("Export YAML"));
}
