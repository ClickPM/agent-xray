/// <reference types="vitest" />
// 测试只能经 `dev.ps1 test`(encore test)运行,禁止裸跑 vitest(CLAUDE.md 规则 2)。
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~encore": fileURLToPath(new URL("./encore.gen", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "encore.gen/**", ".encore/**"],
  },
});
