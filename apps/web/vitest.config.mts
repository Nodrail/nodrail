import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "server-only": fileURLToPath(new URL("./test/empty.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: [
            "tests/**/*.test.ts",
            "../../packages/sdk/tests/client/**/*.test.ts",
            "../../packages/agent-plugins/tests/**/*.test.ts",
          ],
          exclude: ["tests/backend/**"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "backend",
          environment: "node",
          include: ["tests/backend/**/*.test.ts"],
          globalSetup: ["./tests/backend/global-setup.ts"],
          testTimeout: 20000,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "components",
          // Lets vi.mock replace Next modules such as next/script.
          server: { deps: { inline: ["next"] } },
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./test/setup.ts"],
        },
      },
    ],
  },
});
