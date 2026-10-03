import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.js"],
    // Every integration test rebuilds the schema of the same database, so two
    // files running at once would tear the schema out from under each other.
    // Sequential execution is a correctness requirement here, not a preference.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
