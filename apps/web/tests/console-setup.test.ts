import { describe, expect, test, vi } from "vitest";
import { agentProject } from "@/features/agents/presentation";
import { docsUrl } from "@/features/guidance/docs-url";
import { reportingEndpoint } from "@/features/reporting/endpoint";
import { tokenInputFromForm } from "@/features/settings/token-input";

vi.mock("@/server/app-origin", () => ({
  appOrigin: () => "https://console.example.test",
}));

test("the external collector endpoint identifies the selected environment", () => {
  expect(reportingEndpoint("production")).toBe(
    "https://console.example.test/api/v1/otlp/v1/traces?environment=production",
  );
});

test("console help uses the documentation origin", () => {
  const target = new URL(docsUrl("self-hosting#account-provisioning"));
  expect(target.pathname).toBe("/docs/self-hosting");
  expect(target.hash).toBe("#account-provisioning");
  expect(target.origin).toBe(
    new URL(
      process.env.NEXT_PUBLIC_NODRAIL_DOCS_ORIGIN || "https://nodrail.com",
    ).origin,
  );
});

test("labels an agent declared by a project", () => {
  expect(agentProject({ key: "support", project: "support-desk" })).toBe(
    "from support-desk",
  );
  expect(agentProject({ key: "standalone" })).toBeNull();
});

function tokenForm(fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    name: "Work laptop",
    expiresInDays: "90",
    ...fields,
  }))
    form.set(key, value);
  return form;
}

describe("token input from the console", () => {
  test("personal access includes read and the selected scopes", () => {
    expect(
      tokenInputFromForm(tokenForm({ scopes: "rules:write" })),
    ).toMatchObject({
      ok: true,
      input: { scopes: ["read", "rules:write"] },
    });
  });

  test("reporting can only be used on its own", () => {
    const form = tokenForm({ tokenType: "reporting" });
    expect(tokenInputFromForm(form)).toMatchObject({
      ok: true,
      input: { scopes: ["inventory:write"] },
    });
    form.append("scopes", "rules:write");
    expect(tokenInputFromForm(form)).toMatchObject({
      ok: false,
      message: expect.stringContaining("only scope"),
    });
  });

  test.each([
    [{ name: " " }, "token name"],
    [{ expiresInDays: "5" }, "expiry options"],
    [{ expiresInDays: "" }, "expiry options"],
    [{ scopes: "publish" }, "access scopes"],
  ])("identifies the invalid field in %j", (fields, error) => {
    expect(tokenInputFromForm(tokenForm(fields))).toMatchObject({
      ok: false,
      message: expect.stringContaining(error),
    });
  });
});
