import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Process wiring around the tested modules: the stdio entry.
      exclude: ["src/bin.ts"],
      reporter: ["text-summary"],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
});
