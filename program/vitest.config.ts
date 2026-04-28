import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Allow .js imports to resolve to .ts source files (ESM compat pattern)
    extensions: [".ts", ".js"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
