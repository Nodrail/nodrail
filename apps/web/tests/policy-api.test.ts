import { afterEach, expect, test, vi } from "vitest";
import {
  publishPolicyFile,
  reviewPolicyFile,
} from "@/features/policies/policy-api";

const place = { workspace: "service-team", environment: "production" };
const yaml = "version: 1\nrules: []\n";
const token = "a".repeat(43);
const project = "9841255d-29a3-4d68-b41d-b2d10d8d760b";
const csrf = () => Response.json({ token });

afterEach(() => vi.unstubAllGlobals());

test("reviews over a session and preserves the revision, digest and reviewed project on publish", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(csrf())
    .mockResolvedValueOnce(
      Response.json({
        policy_revision: 12,
        file_digest: "reviewed",
        issues: [],
        warnings: [],
        added: ["Read issues"],
        changed: [],
        removed: [],
        unchanged: 0,
      }),
    )
    .mockResolvedValueOnce(csrf())
    .mockResolvedValueOnce(
      Response.json({
        policy_revision: 13,
        added: 1,
        changed: 0,
        removed: 0,
      }),
    );
  vi.stubGlobal("fetch", fetch);

  const reviewed = await reviewPolicyFile(place, yaml);
  expect(reviewed).toMatchObject({
    status: "ok",
    data: { policyRevision: 12, fileDigest: "reviewed" },
  });
  if (reviewed.status !== "ok" || !reviewed.data)
    throw new Error("Preview missing");
  expect(
    await publishPolicyFile(place, yaml, reviewed.data, project),
  ).toMatchObject({
    status: "ok",
    data: { policyRevision: 13, added: 1 },
  });
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "/api/v1/session/csrf",
    expect.objectContaining({
      credentials: "same-origin",
      headers: { "X-Nodrail-CSRF": "fetch" },
    }),
  );
  const query = "?workspace=service-team&environment=production";
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    `/api/v1/rules/preview${query}`,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ yaml }),
    }),
  );
  expect(fetch).toHaveBeenNthCalledWith(
    4,
    `/api/v1/rules/publish${query}`,
    expect.objectContaining({
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Nodrail-CSRF": token },
      body: JSON.stringify({
        yaml,
        policy_revision: 12,
        file_digest: "reviewed",
        reviewed_project_id: project,
      }),
    }),
  );
});

test("reports a stale file review without retrying the publish", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(csrf())
    .mockResolvedValueOnce(
      Response.json({ error: { code: "RULE_CHANGED" } }, { status: 409 }),
    );
  vi.stubGlobal("fetch", fetch);
  const result = await publishPolicyFile(
    place,
    yaml,
    {
      policyRevision: 12,
      fileDigest: "reviewed",
    },
    null,
  );
  expect(result).toMatchObject({
    status: "error",
    message: expect.stringContaining("preview again"),
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
