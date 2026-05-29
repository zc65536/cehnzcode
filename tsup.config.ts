import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  splitting: false,
  // 强制把所有依赖内联进单文件，pkg 打包时不再需要 node_modules
  noExternal: [/^(?!node:).*/],
  esbuildOptions(options) {
    // 使用 node/require 条件解析 ESM 包的 CJS 版本
    options.conditions = ["node", "require", "default"];
  },
});
