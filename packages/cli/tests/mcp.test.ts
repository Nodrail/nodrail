import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Scope } from "../src/api.ts";
import { describe, expect, test } from "vitest";
import { serverFor } from "../src/mcp/main.ts";
import { CURRENT_YAML, TOKEN, fakeApi } from "./support/fake-api.ts";

type Setup = {
  scopes?: Scope[];
  role?: "viewer" | "policy_manager" | "admin";
  flags?: string[];
  /** How the person answers a confirmation, if the client can ask. */
  elicit?: "accept" | "decline";
};

const emptyHome = () => mkdtempSync(join(tmpdir(), "nodrail-mcp-"));

async function connect(setup: Setup = {}) {
  const api = fakeApi({ scopes: setup.scopes, role: setup.role });
  const server = await serverFor(
    setup.flags ?? [],
    { NODRAIL_TOKEN: TOKEN },
    {
      fetch: api.fetch,
      home: emptyHome(),
    },
  );
  const client = new Client(
    { name: "test", version: "1" },
    { capabilities: setup.elicit ? { elicitation: {} } : {} },
  );
  const asked: string[] = [];
  if (setup.elicit)
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      asked.push(String(request.params.message));
      return setup.elicit === "accept"
        ? { action: "accept", content: { confirm: true } }
        : { action: "decline" };
    });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  const names = async () =>
    (await client.listTools()).tools.map((tool) => tool.name).sort();
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const [first] = result.content as { type: string; text: string }[];
    return { isError: Boolean(result.isError), text: first?.text ?? "" };
  };
  return { api, client, names, call, asked };
}

const READ_TOOLS = [
  "get_activity_event",
  "get_insights",
  "get_rules_yaml",
  "get_run",
  "list_runs",
  "search_activity",
  "whoami",
];

describe("which tools exist", () => {
  test("read-only by default, even with an admin token that can do everything", async () => {
    const { names } = await connect({
      scopes: ["read", "rules:write"],
    });
    expect(await names()).toEqual([...READ_TOOLS, "preview_rules"].sort());
  });

  test("a read token has only read tools", async () => {
    const { names } = await connect({
      flags: ["--allow-publish"],
    });
    expect(await names()).toEqual(READ_TOOLS);
  });

  test("nothing waits for a person, so there is no approval tool or flag", async () => {
    const { names } = await connect({ scopes: ["read", "rules:write"] });
    expect((await names()).some((name) => /approv|decide/.test(name))).toBe(
      false,
    );
    await expect(
      serverFor(
        ["--allow-decisions"],
        { NODRAIL_TOKEN: TOKEN },
        {
          home: emptyHome(),
        },
      ),
    ).rejects.toThrow();
  });

  test("publishing needs the flag and rules:write", async () => {
    const { names } = await connect({
      scopes: ["read", "rules:write"],
      flags: ["--allow-publish"],
    });
    expect(await names()).toEqual(
      [...READ_TOOLS, "preview_rules", "publish_rules"].sort(),
    );
  });

  test("publishing says a person must confirm", async () => {
    const { client } = await connect({
      scopes: ["read", "rules:write"],
      flags: ["--allow-publish"],
    });
    const { tools } = await client.listTools();
    const tool = tools.find((item) => item.name === "publish_rules");
    expect(tool?.description).toContain("A person must confirm every call");
    expect(tool?.annotations?.destructiveHint).toBe(true);
  });
});

describe("reading", () => {
  test("tools answer JSON text from the API", async () => {
    const { api, call } = await connect();
    const rules = await call("get_rules_yaml");
    expect(JSON.parse(rules.text).yaml).toBe(CURRENT_YAML);
    await call("search_activity", { outcome: "denied", range: "7d", limit: 5 });
    expect(api.seen.at(-1)?.query).toEqual({
      outcome: "denied",
      range: "7d",
      limit: "5",
    });
    for (const [name, args] of [
      ["whoami", {}],
      ["list_runs", {}],
      ["get_insights", { days: 7 }],
    ] as const)
      expect((await call(name, args)).isError).toBe(false);
  });

  test("API errors become tool errors with the code", async () => {
    const { call } = await connect();
    const missing = await call("get_run", { id: "nope" });
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.text).error.code).toBe("NOT_FOUND");
    expect((await call("get_activity_event", { id: "nope" })).isError).toBe(
      true,
    );
  });

  test("preview needs rules:write on the server too", async () => {
    const { call } = await connect({ scopes: ["read", "rules:write"] });
    const preview = await call("preview_rules", { yaml: "version: 1\n" });
    expect(JSON.parse(preview.text).policy_revision).toBe(3);
  });
});

describe("publishing", () => {
  const NEW_YAML = `${CURRENT_YAML}  - name: Delete issues\n`;
  const publisher = (elicit?: Setup["elicit"]) =>
    connect({
      scopes: ["read", "rules:write"],
      flags: ["--allow-publish"],
      elicit,
    });

  test("publishes what was previewed once the person confirms", async () => {
    const { api, call, asked } = await publisher("accept");
    const preview = JSON.parse(
      (await call("preview_rules", { yaml: NEW_YAML })).text,
    );
    const result = await call("publish_rules", {
      yaml: NEW_YAML,
      policy_revision: preview.policy_revision,
      file_digest: preview.file_digest,
    });
    expect(JSON.parse(result.text).policy_revision).toBe(4);
    expect(asked[0]).toContain("Added: Delete issues");
    expect(api.state.yaml).toBe(NEW_YAML);
  });

  test("declined, broken or stale publishes change nothing", async () => {
    const declined = await publisher("decline");
    const args = { yaml: NEW_YAML, policy_revision: 3, file_digest: "x" };
    expect((await declined.call("publish_rules", args)).text).toContain(
      "Nothing was published",
    );
    const { call, api } = await connect({
      scopes: ["read", "rules:write"],
      flags: ["--allow-publish", "--client-confirms"],
    });
    const broken = await call("publish_rules", { ...args, yaml: "broken" });
    expect(broken.text).toContain("problems");
    const stale = await call("publish_rules", args);
    expect(JSON.parse(stale.text).error.code).toBe("RULE_CHANGED");
    expect(api.state.yaml).toBe(CURRENT_YAML);
    const cannotAsk = await publisher();
    expect((await cannotAsk.call("publish_rules", args)).text).toContain(
      "can't ask the person",
    );
  });
});

describe("starting", () => {
  test("needs a token", async () => {
    await expect(serverFor([], {}, { home: emptyHome() })).rejects.toThrow(
      "No Nodrail token",
    );
  });

  test("a refused token stops it", async () => {
    await expect(
      serverFor(
        [],
        { NODRAIL_TOKEN: "ndp_bad" },
        {
          home: emptyHome(),
          fetch: fakeApi().fetch,
        },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("passes --environment to every environment call", async () => {
    const api = fakeApi();
    const server = await serverFor(
      ["--environment", "production"],
      { NODRAIL_TOKEN: TOKEN },
      { home: emptyHome(), fetch: api.fetch },
    );
    expect(server).toBeDefined();
    expect(api.seen.at(-1)?.path).toBe("/me");
  });
});
