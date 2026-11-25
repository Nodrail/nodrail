import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, expect, test, vi } from "vitest";
import config from "../next.config";
import { deploymentMode } from "@/server/deployment";

afterEach(() => vi.unstubAllEnvs());

test.each([{ VERCEL: "1" }, { VERCEL_ENV: "preview" }])(
  "requires explicit cloud mode for $VERCEL$VERCEL_ENV",
  (vercel) => {
    vi.stubEnv("VERCEL", vercel.VERCEL);
    vi.stubEnv("VERCEL_ENV", vercel.VERCEL_ENV);
    for (const value of [undefined, "", "self-hosted", "bad-mode"]) {
      vi.stubEnv("NODRAIL_DEPLOYMENT", value);
      expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(
        "Set NODRAIL_DEPLOYMENT=cloud",
      );
      expect(() => deploymentMode()).toThrow("Set NODRAIL_DEPLOYMENT=cloud");
    }
    vi.stubEnv("NODRAIL_DEPLOYMENT", "cloud");
    expect(() => config(PHASE_PRODUCTION_BUILD)).not.toThrow();
    expect(deploymentMode()).toBe("cloud");
  },
);

test("a standalone build and runtime still default to self-hosted", () => {
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NODRAIL_DEPLOYMENT", undefined);
  expect(() => config(PHASE_PRODUCTION_BUILD)).not.toThrow();
  expect(deploymentMode()).toBe("self-hosted");
});
