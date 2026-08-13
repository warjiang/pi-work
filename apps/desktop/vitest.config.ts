import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/renderer"),
      "@resources": resolve(import.meta.dirname, "resources"),
    },
  },
});
