import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration suites truncate the same tables, so files must not run concurrently.
    fileParallelism: false,
    passWithNoTests: false
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } }
});
