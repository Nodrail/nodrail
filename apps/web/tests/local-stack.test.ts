// The shared test Postgres: a backend or e2e run starts it when it isn't
// serving and never recreates it, so other suites' databases on it survive.
// Docker is never called here: a fake `docker compose` records the calls.
import { describe, expect, test } from "vitest";
import {
  ensureTestContainer,
  testContainerServing,
} from "./support/local-stack";

const entry = (fields: Record<string, string>) =>
  JSON.stringify({
    Service: "postgres-test",
    Name: "web-postgres-test-1",
    ...fields,
  });
const HEALTHY = entry({ State: "running", Health: "healthy" });

function fakeCompose(ps: string) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    return args[0] === "ps" ? ps : "";
  };
  return { calls, run };
}

describe("the shared test container", () => {
  test("serving only when running and healthy", () => {
    expect(testContainerServing(HEALTHY)).toBe(true);
    expect(testContainerServing(`[${HEALTHY}]`)).toBe(true);
    expect(testContainerServing(`${HEALTHY}\n`)).toBe(true);
    for (const ps of [
      "",
      "\n",
      "[]",
      entry({ State: "running", Health: "starting" }),
      entry({ State: "running", Health: "unhealthy" }),
      entry({ State: "exited", Health: "" }),
      JSON.stringify({
        Service: "postgres",
        State: "running",
        Health: "healthy",
      }),
    ])
      expect(testContainerServing(ps), ps).toBe(false);
  });

  test("a serving container is left alone", () => {
    const { calls, run } = fakeCompose(HEALTHY);
    ensureTestContainer(run);
    expect(calls).toEqual([["ps", "--format", "json", "postgres-test"]]);
  });

  test.each([
    ["a cold start", ""],
    ["a stopped container", entry({ State: "exited", Health: "" })],
    ["one still starting", entry({ State: "running", Health: "starting" })],
  ])("%s is started and waited for, never recreated", (_, ps) => {
    const { calls, run } = fakeCompose(ps);
    ensureTestContainer(run);
    expect(calls).toEqual([
      ["ps", "--format", "json", "postgres-test"],
      ["up", "-d", "--wait", "--no-recreate", "postgres-test"],
    ]);
    expect(calls.flat()).not.toContain("--force-recreate");
  });
});
