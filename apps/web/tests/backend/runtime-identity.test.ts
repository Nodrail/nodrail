// `GET /api/v1/runtime/identity` (connected mode): whose credential
// this is, so `nodrail plan` can check it against what `connect:` says.
import { describe, expect, test } from "vitest";
import { withRuntime } from "@/server/db/runtime-context";
import { DATA_PLANE_SCOPES } from "@/server/db/runtime-scopes";
import { readIdentity } from "@/server/modules/runtime/identity";
import {
  admin,
  createAgent,
  issueToken,
  useDatabase,
  workspaceWithToken,
} from "./world";

useDatabase();

const identity = (token: string) =>
  withRuntime(token, "actions:read-own", (context) => readIdentity(context));

const slugOf = async (table: "workspaces" | "environments", id: string) =>
  (
    await admin.query(`SELECT slug FROM nodrail.${table} WHERE id = $1`, [id])
  )[0].slug as string;

describe("a credential's identity", () => {
  test("names its workspace, environment and agent by slug and key", async () => {
    const { w, token } = await workspaceWithToken();
    expect(await identity(token)).toEqual({
      workspace: await slugOf("workspaces", w.id),
      environment: await slugOf("environments", w.environmentId),
      agent: "bot",
      policy_digest: null,
      live_policy_digest: null,
      policy_skew: null,
    });
  });

  test("each credential answers for itself, not another agent's", async () => {
    const { w } = await workspaceWithToken();
    const other = await issueToken(w, await createAgent(w, "other-bot"));
    expect((await identity(other)).agent).toBe("other-bot");
  });

  test("a credential that isn't valid gets nothing", async () => {
    await expect(
      identity("ndr_000000000000_" + "A".repeat(43)),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("a credential's scopes", () => {
  test("a new credential can do what the data plane asks for", async () => {
    const { token } = await workspaceWithToken();
    const [row] = await admin.query(
      `SELECT scopes FROM nodrail.installation_credentials WHERE public_prefix = $1`,
      [token.split("_")[1]],
    );
    expect(row.scopes).toEqual(
      expect.arrayContaining([...DATA_PLANE_SCOPES, "actions:submit"]),
    );
  });
});
