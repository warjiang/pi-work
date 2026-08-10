import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const workspaceAliases = {
  "@pi-work/artifacts": resolve(workspaceRoot, "packages/artifacts/src/index.ts"),
  "@pi-work/pi-adapter": resolve(workspaceRoot, "packages/pi-adapter/src/index.ts"),
  "@pi-work/policy": resolve(workspaceRoot, "packages/policy/src/index.ts"),
  "@pi-work/protocol": resolve(workspaceRoot, "packages/protocol/src/index.ts"),
  "@pi-work/storage": resolve(workspaceRoot, "packages/storage/src/index.ts"),
};

export default defineConfig({
  main: {
    resolve: {
      alias: workspaceAliases,
    },
    ssr: {
      noExternal: Object.keys(workspaceAliases),
    },
    build: {
      externalizeDeps: {
        exclude: Object.keys(workspaceAliases),
      },
      rollupOptions: {
        external: [
          "electron",
          "better-sqlite3",
          "@earendil-works/pi-coding-agent",
        ],
        input: {
          index: resolve("src/main/index.ts"),
          "agent-service": resolve("src/agent/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: workspaceAliases,
    },
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve("src/renderer"),
        ...workspaceAliases,
      },
    },
  },
});
