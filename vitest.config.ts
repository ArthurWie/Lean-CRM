import { defineConfig } from "vitest/config";

// jsdom environment so React component tests can render (Wave 0 gap).
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Harness loads green before any tests exist (Wave 0); real tests land in Task 3.
    passWithNoTests: true,
  },
});
