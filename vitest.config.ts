import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".tmp/vitest-cache",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  test: {
    environment: "node",
    globals: true,
    pool: "forks"
  }
});
