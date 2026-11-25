import { describe, expect, test } from "vitest";
import { describeError, safePath } from "@/server/log";

describe("what reaches the logs", () => {
  test("a database error keeps its code, never its query or values", () => {
    const error = Object.assign(new Error('bad value "top-secret"'), {
      driverError: { code: "22P02" },
      query: "INSERT ...",
      parameters: ["top-secret"],
    });
    expect(describeError(error)).toEqual({ name: "Error", code: "22P02" });
  });

  test("a mail error does not quote the address", () => {
    const error = Object.assign(new Error("rejected a@b.test"), {
      code: "EENVELOPE",
    });
    expect(JSON.stringify(describeError(error))).not.toContain("a@b.test");
  });

  test("a programming error keeps what is needed to fix it", () => {
    expect(describeError(new TypeError("x is not a function"))).toMatchObject({
      name: "TypeError",
      message: "x is not a function",
    });
  });

  test("a wrapped failure keeps its reason, under the same rules", () => {
    const reason = Object.assign(new Error("rejected a@b.test"), {
      code: "ECONNRESET",
    });
    const error = Object.assign(new Error("Could not reach Stripe"), {
      detail: reason,
    });
    const logged = describeError(error);
    expect(logged).toMatchObject({
      message: "Could not reach Stripe",
      cause: { code: "ECONNRESET" },
    });
    expect(JSON.stringify(logged)).not.toContain("a@b.test");
  });

  test("something that is not an error reveals nothing", () => {
    expect(describeError("top-secret")).toEqual({ name: "Unknown" });
  });
});

describe("paths in logs", () => {
  test.each([
    ["/invite/ndi_secret", "/invite/[token]"],
    ["/auth/confirm?token_hash=abc", "/auth/confirm"],
    ["/app/acme/development/agents?cursor=x", "/app/acme/development/agents"],
  ])("%s becomes %s", (path, expected) => {
    expect(safePath(path)).toBe(expected);
  });
});
