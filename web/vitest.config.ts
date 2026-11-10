import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ resolve: { alias: { "@": path.resolve(__dirname), "server-only": path.resolve(__dirname, "tests/shims/server-only.ts") } }, test: { include: ["tests/**/*.test.ts"], environment: "node" } });
