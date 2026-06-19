import { defineConfig } from "vitest/config";

// jsdom environment so React component tests can render (Wave 0 gap).
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Harness loads green before any tests exist (Wave 0); real tests land in Task 3.
    passWithNoTests: true,
    // Run tests in forked worker processes and inject --experimental-sqlite so
    // the data-layer test can use the node:sqlite builtin (Node 22) to mock the
    // plugin over a real in-memory DB. Cross-platform: no NODE_OPTIONS / cross-env.
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--experimental-sqlite", "--no-warnings"],
      },
    },
  },
});
