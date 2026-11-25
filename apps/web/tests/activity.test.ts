import { describe, expect, test } from "vitest";
import {
  activityCatalog,
  describeActivity,
  type ActivityEventDto,
} from "@/contracts/v1/activity";
import { activityQuery } from "@/contracts/v1/activity-query";
import { exportRow, exportText } from "@/features/activity/export-file";
import {
  activityHref,
  exportHref,
  isFiltered,
  readActivityParams,
} from "@/features/activity/filters";
import { csvField, toCsv } from "@/lib/csv";
import {
  actorLabel,
  eventTitle,
  explainEvent,
} from "@/features/activity/presentation";
import { formatUtc, timeUntil } from "@/lib/time";

const defaults = activityQuery.parse({});

const event = (overrides: Partial<ActivityEventDto>): ActivityEventDto => ({
  id: "id",
  occurredAt: "2026-11-09T07:09:30.000Z",
  code: "denied_by_rule",
  group: "decision",
  outcome: "denied",
  label: "Denied by rule",
  actor: { kind: "human", name: null },
  agentKey: null,
  action: null,
  environment: null,
  rule: null,
  subject: null,
  detail: null,
  latestReport: null,
  ...overrides,
});

describe("the query", () => {
  test("defaults to everything", () => {
    expect(defaults).toEqual({
      kind: "all",
      outcome: "all",
      agent: "",
      run: "",
      range: "all",
      q: "",
    });
    expect(isFiltered(defaults)).toBe(false);
  });

  test("ignores what it does not recognise", () => {
    expect(
      activityQuery.parse({
        kind: "x",
        outcome: 1,
        range: "1y",
        agent: "a".repeat(101),
        q: "a".repeat(201),
      }),
    ).toEqual(defaults);
  });

  test("trims the search and the agent", () => {
    const query = activityQuery.parse({ q: "  term ", agent: " support " });
    expect(query).toMatchObject({ q: "term", agent: "support" });
  });
});

describe("the address", () => {
  test("reads the view, every filter and the open event", () => {
    expect(
      readActivityParams({
        view: "runs",
        kind: "changes",
        outcome: "held",
        agent: "support",
        run: "r1",
        range: "7d",
        q: "deploy",
        cursor: "c",
        event: "e1",
      }),
    ).toEqual({
      view: "runs",
      event: "e1",
      query: {
        kind: "changes",
        outcome: "held",
        agent: "support",
        run: "r1",
        range: "7d",
        q: "deploy",
        cursor: "c",
      },
    });
  });

  test("starts on events, with nothing open", () => {
    expect(readActivityParams({})).toEqual({
      view: "events",
      query: defaults,
      event: undefined,
    });
  });

  test("an old view of a kind of event still filters by it", () => {
    const { view, query } = readActivityParams({ view: "changes" });
    expect(view).toBe("events");
    expect(query.kind).toBe("changes");
    expect(
      readActivityParams({ view: "changes", kind: "reports" }).query.kind,
    ).toBe("reports");
  });

  test("a repeated value is no value", () => {
    expect(
      readActivityParams({ outcome: ["denied", "allowed"] }).query.outcome,
    ).toBe("all");
  });
});

describe("links", () => {
  test("leave defaults out", () => {
    expect(activityHref("/a", defaults)).toBe("/a");
    expect(activityHref("/a", defaults, "runs")).toBe("/a?view=runs");
  });

  test("carry and encode what is set", () => {
    expect(
      activityHref("/a", {
        kind: "reports",
        outcome: "denied",
        agent: "support",
        run: "r1",
        range: "24h",
        q: "a b&c",
        cursor: "abc",
      }),
    ).toBe(
      "/a?kind=reports&outcome=denied&agent=support&run=r1&range=24h&q=a+b%26c&cursor=abc",
    );
  });

  test("runs keep the shared filters and drop kind and run", () => {
    const query = {
      ...defaults,
      kind: "changes",
      run: "r1",
      agent: "x",
    } as const;
    expect(activityHref("/a", query, "runs")).toBe("/a?view=runs&agent=x");
    expect(isFiltered({ ...defaults, kind: "changes" }, "runs")).toBe(false);
  });

  test("an export carries the filters, never the page", () => {
    expect(
      exportHref("/a", { ...defaults, outcome: "held", cursor: "c" }, "json"),
    ).toBe("/a/export?outcome=held&format=json");
    expect(exportHref("/a", defaults, "csv")).toBe("/a/export?format=csv");
  });
});

describe("CSV", () => {
  test("quotes commas, quotes and line breaks as RFC 4180 asks", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
  });

  test.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"])(
    "neutralises %j so no spreadsheet runs it",
    (text) => {
      expect(csvField(text).replace(/^"/, "")).toMatch(/^'/);
    },
  );

  test("a neutralised cell is still quoted when it needs to be", () => {
    expect(csvField('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  test("lines end in CRLF, the last one too", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });
});

describe("the export file", () => {
  const decided = event({
    agentKey: "support",
    action: {
      toolKey: "github",
      operationKey: "issues.delete",
      resourceKind: "issue",
      resource: "=cmd|' /C calc'!A0",
      installationName: "support-dev",
      run: { id: "r1", key: "feat/x" },
      reference: "REQ-ABCDEF12",
    },
    actor: { kind: "human", name: "Ana" },
  });

  test("has the same columns in the same order every time", () => {
    const [header] = exportText("csv", [], { capped: false, limit: 10 }).split(
      "\r\n",
    );
    expect(header).toBe(
      "time_utc,agent,installation,tool,operation,resource,outcome,decided_by,reason,run,request_id",
    );
  });

  test("one event is one row, in UTC", () => {
    expect(exportRow(decided)).toEqual({
      time_utc: "2026-11-09T07:09:30.000Z",
      agent: "support",
      installation: "support-dev",
      tool: "github",
      operation: "issues.delete",
      resource: "=cmd|' /C calc'!A0",
      outcome: "denied",
      decided_by: "Ana",
      reason: "Denied by rule",
      run: "feat/x",
      request_id: "REQ-ABCDEF12",
    });
  });

  test("a resource an agent wrote cannot become a formula", () => {
    const [, row] = exportText("csv", [decided], {
      capped: false,
      limit: 10,
    }).split("\r\n");
    expect(row).toContain(",'=cmd|' /C calc'!A0,");
  });

  test("JSON says how many and whether the limit cut it short", () => {
    const parsed = JSON.parse(
      exportText("json", [decided], { capped: true, limit: 1 }),
    ) as { count: number; capped: boolean; limit: number; events: unknown[] };
    expect(parsed).toMatchObject({ count: 1, capped: true, limit: 1 });
    expect(parsed.events[0]).toMatchObject({ resource: "=cmd|' /C calc'!A0" });
  });
});

describe("the catalog", () => {
  test("a call no rule covers is a denial, and nothing waits", () => {
    expect(describeActivity("denied_no_rule")).toMatchObject({
      group: "decision",
      outcome: "denied",
    });
    expect(
      Object.values(activityCatalog).map((entry) => entry.outcome),
    ).not.toContain("waiting");
    expect(describeActivity("approval_pending")).toMatchObject({
      group: "change",
    });
  });

  test("only decisions have a decision outcome", () => {
    for (const entry of Object.values(activityCatalog))
      expect(entry.outcome === "informational").toBe(entry.group === "change");
  });

  test("an unknown code is never presented as a decision", () => {
    expect(describeActivity("something_new")).toMatchObject({
      group: "change",
      outcome: "informational",
    });
  });
});

describe("wording", () => {
  test("names who acted", () => {
    expect(actorLabel(event({ actor: { kind: "human", name: "Ana" } }))).toBe(
      "Ana",
    );
    expect(actorLabel(event({}))).toBe("A former member");
    expect(
      actorLabel(
        event({ actor: { kind: "human", name: "Ana", via: "laptop" } }),
      ),
    ).toBe("Ana via API token laptop");
    expect(actorLabel(event({ actor: { kind: "runtime", name: null } }))).toBe(
      "Agent integration",
    );
    expect(actorLabel(event({ actor: { kind: "system", name: null } }))).toBe(
      "Nodrail policy engine",
    );
  });

  test("never guesses a hidden subject", () => {
    expect(eventTitle(event({}))).toBe(
      "A request on an agent not assigned to you",
    );
    expect(eventTitle(event({ group: "change", code: "agent_paused" }))).toBe(
      "An agent not assigned to you",
    );
    expect(
      eventTitle(
        event({
          group: "change",
          rule: { kind: "rule", id: "r", name: null, revision: null },
        }),
      ),
    ).toBe("A rule you can't see");
  });

  test("explains a call no rule covers", () => {
    expect(explainEvent(event({ code: "denied_no_rule" }))).toContain(
      "No rule covers this call",
    );
  });

  test("a change needs no explanation", () => {
    expect(explainEvent(event({ code: "agent_paused" }))).toBeNull();
  });

  test.each([
    [23, "23 min"],
    [120, "2 hours"],
    [60 * 24 * 7, "7 days"],
  ])("%i minutes away reads as %s", (minutes, expected) => {
    const now = Date.parse("2026-11-09T00:00:00.000Z");
    expect(timeUntil(new Date(now + minutes * 60_000).toISOString(), now)).toBe(
      expected,
    );
  });

  test("an absolute time is in UTC", () => {
    expect(formatUtc("2026-11-09T07:09:30.000Z")).toBe("2026-11-09 07:09 UTC");
  });
});
