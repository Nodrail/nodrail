import { describe, expect, test } from "vitest";
import { safeNextPath } from "@/features/auth/next-path";

describe("safeNextPath", () => {
  test.each([
    ["/app"],
    ["/app/acme-studio"],
    ["/app/acme-studio/development/agents"],
    ["/invite/ndi_abc-123"],
  ])("keeps %s in both modes", (path) => {
    expect(safeNextPath(path, false)).toBe(path);
    expect(safeNextPath(path, true)).toBe(path);
  });

  test.each([["/"], ["/acme-studio"], ["/acme-studio/development/agents"]])(
    "keeps the short URL %s on the app host",
    (path) => {
      expect(safeNextPath(path, true)).toBe(path);
      expect(safeNextPath(path, false)).toBe("/app");
    },
  );

  test.each([
    ["//evil.example/app"],
    ["https://evil.example/app"],
    ["/\\evil.example"],
    ["/login"],
    ["/signup"],
    ["/docs"],
    ["/api/v1/x"],
    ["/app//evil.example"],
    ["/app/../login"],
    ["/app?x=1"],
    ["/invite"],
    ["/invite/"],
    ["/invite/a/b"],
    ["/invite/../app"],
    ["//evil.example"],
    [""],
    [undefined],
    [["/app/acme"]],
  ])("falls back for %j", (value) => {
    expect(safeNextPath(value, false)).toBe("/app");
    expect(safeNextPath(value, true)).toBe("/");
  });

  test("/application is a product page only with short URLs", () => {
    expect(safeNextPath("/application", false)).toBe("/app");
    expect(safeNextPath("/application", true)).toBe("/application");
  });
});
