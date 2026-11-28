import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    // Real git, Node and CLI subprocesses can take longer on shared runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // A little under today's coverage, so a real drop fails CI. The engine
    // and the client (src/client) each keep their own bar, measured apart,
    // as well as the whole package.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // The process entry points only wire up the tested modules; tests that
      // run them as separate processes cover them, but aren't measured.
      exclude: ["src/cli.ts", "src/client/hook-main.ts"],
      reporter: ["text-summary"],
      thresholds: {
        statements: 94,
        branches: 90,
        functions: 94,
        lines: 95,
        "src/{*.ts,!(client)/**}": {
          statements: 94,
          branches: 90,
          functions: 94,
          lines: 95,
        },
        "src/client/**": {
          statements: 97,
          branches: 92,
          functions: 97,
          lines: 97,
        },
      },
    },
  },
});
