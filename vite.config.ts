import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri expects a fixed port and does not want vite to obscure rust errors.
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: {
      // src-tauri is watched by cargo, not vite.
      //
      // Worktrees are nested inside the repo at `.claude/worktrees/<branch>`,
      // so without excluding them this dev server watches every other branch
      // checked out beside it — one worktree's edits reload another's app, and
      // a tsconfig change over there wipes this server's dep cache.
      ignored: ["**/src-tauri/**", "**/.claude/worktrees/**"],
    },
  },
  build: {
    // Mermaid and Shiki are large; they are lazily imported so they land in
    // their own chunks. Raising the warning limit keeps the build output quiet
    // about chunks we deliberately code-split.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    // Theme application writes CSS custom properties onto a real element, so
    // the default vitest environment has to be a DOM (see lib/theme/apply.ts).
    environment: "jsdom",
    // `scripts/` is covered too: the release rules there decide what ships, so they are
    // tested like app code rather than trusted because they are "just a build script".
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
}));
