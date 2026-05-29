# cehnzcode.exe 打包修改报告

**日期**：2026-05-27  
**目标**：将 Node.js CLI 项目打包为独立 Windows .exe 文件  
**工具**：`@yao-pkg/pkg` v6.19.0 + `tsup` v8.5.1

---

## 修改文件清单

### 1. `src/config/index.ts` — dotenv 加载时机问题

**问题**：原来的 `import 'dotenv/config'` 写在 `src/index.ts` 顶部，作为副作用导入。pkg 打包后，由于模块初始化顺序改变，`config` 模块会在 dotenv 加载 `.env` 文件之前就被初始化，导致 `API_KEY` 读取失败（ZodError: apiKey Required）。

**修改**：在 `config/index.ts` 顶部显式调用 `loadDotenv()`，让 config 模块自己负责加载环境变量，不再依赖外部的初始化顺序。

```diff
+ import { config as loadDotenv } from "dotenv";
+
+ // 显式加载 .env，保证无论模块初始化顺序如何都能正确读取环境变量
+ loadDotenv();
```

---

### 2. `src/index.ts` — 移除冗余的 dotenv 导入

**修改**：移除顶部的 `import 'dotenv/config'`，因为 `config/index.ts` 已经负责加载。

```diff
- import 'dotenv/config'
```

---

### 3. `src/logger/index.ts` — pino Worker 线程问题

**问题**：pino 默认使用 `transport: { target: "pino/file" }` 配置，会在运行时启动一个 Worker 线程来异步写日志。pkg 打包后 Worker 线程需要加载 `dist/lib/worker.js`，但该路径在 snapshot 虚拟文件系统中不存在，导致启动崩溃。

**修改**：去掉 worker-based transport，改用 `pino.destination` 同步直接写 stderr。对 CLI 工具而言，同步日志完全够用。

```diff
- logger = pino({
-   level: config.logLevel,
-   transport: {
-     target: "pino/file",
-     options: { destination: 2 }, // stderr
-   },
- });
+ // 使用同步写入 stderr，避免 Worker 线程（pkg 打包后 Worker 无法加载文件）
+ logger = pino(
+   { level: config.logLevel },
+   pino.destination({ dest: 2, sync: true })
+ );
```

---

### 4. `package.json` — main 字段和 pkg 配置

**问题一**：`main` 和 `bin` 指向 `dist/index.js`（旧 ESM 构建），但打包用的是 `dist/index.cjs`，导致 pkg 打包了错误的入口文件，snapshot 中出现了 ESM chunk 文件。

**问题二**：pkg 需要知道哪些 node_modules 文件要打进 snapshot。

**修改**：

```diff
- "main": "dist/index.js",
- "bin": { "cehnzcode": "dist/index.js" },
+ "main": "dist/index.cjs",
+ "bin": { "cehnzcode": "dist/index.cjs" },

+ "pkg": {
+   "scripts": [
+     "node_modules/openai/**/*.js",
+     "node_modules/@anthropic-ai/sdk/**/*.js",
+     "node_modules/dotenv/**/*.js"
+   ],
+   "assets": [
+     "node_modules/openai/**/*.json",
+     "node_modules/@anthropic-ai/sdk/**/*.json"
+   ]
+ }
```

> 注：pkg 的 `scripts` 字段用于包含需要被 `require()` 的 JS 文件（编译为字节码），`assets` 用于包含 JSON 等静态资源。若改用 `assets` 包含 JS 文件，`require()` 会失败——这是早期踩过的坑。

---

### 5. `tsup.config.ts` — 新建，强制内联所有依赖

**问题**：tsup 默认将 `dependencies` 中的包视为 external（不打包），导致 `dist/index.cjs` 仍包含 `require('openai')` 等外部引用。pkg 在处理这些外部引用时，对于使用 ESM + 动态 shim 机制的包（如 `openai`、`@anthropic-ai/sdk`）无法正确追踪所有动态 `require()` 调用，导致 `_shims/auto/runtime-node.js` 找不到。

**修改**：新建 `tsup.config.ts`，使用 `noExternal: [/^(?!node:).*/]` 将所有非 Node.js 内置模块全部内联到单文件中。

```ts
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
```

内联后构建产物从 **242 KB → 1.90 MB**，但打包成 exe 后不再依赖任何外部 node_modules。

---

## 最终打包命令

```bash
# 构建（单文件 CJS，所有依赖内联）
npx tsup

# 打包为 exe
npx pkg . --targets node20-win-x64 --output cehnzcode.exe
```

---

### 6. `src/commands/index.ts` — 内置命令加载失败

**问题**：启动时日志连续输出 7 条警告，所有内置命令均加载失败：

```
{"level":40,"module":"command-loader","file":"./builtins/clear.js",
 "error":"A dynamic import callback was not specified.","msg":"Failed to load builtin command"}
// ... exit / help / mcp / plan / skill / knowledge 同样报错
```

**原因**：`commands/index.ts` 使用 `await import(file)` 动态加载命令文件。在 Node.js 源码开发环境下这没有问题，但 tsup 将代码打包为单一 CJS 文件后，运行时再用动态 `import()` 去加载 `./builtins/clear.js` 等路径，这些路径在 pkg snapshot 虚拟文件系统中根本不存在，导致全部失败。

**修改**：将 `commands/index.ts` 改为顶部静态 import，所有命令模块在编译期就被 tsup 内联进单文件，不再依赖运行时路径。

```diff
+ import { clearCommand }     from "./builtins/clear.js";
+ import { exitCommand }      from "./builtins/exit.js";
+ import { helpCommand }      from "./builtins/help.js";
+ import { mcpCommand }       from "./builtins/mcp.js";
+ import { planCommand }      from "./builtins/plan.js";
+ import { skillCommand }     from "./builtins/skill.js";
+ import { knowledgeCommand } from "./builtins/knowledge.js";

  export async function loadBuiltinCommands(): Promise<void> {
-   const commandFiles = ["./builtins/clear.js", ...];
-   for (const file of commandFiles) {
-     const mod = await import(file);   // ← 打包后运行时找不到路径
-     ...
-   }
+   const commands = [
+     clearCommand, exitCommand, helpCommand,
+     mcpCommand, planCommand, skillCommand, knowledgeCommand,
+   ];
    commandRegistry.registerAll(commands);
  }
```

**修复效果**：

修复前启动日志：
```
Failed to load builtin command: clear.js   × 7 条 warn
Builtin commands registered               ← 实际注册数为 0
```

修复后启动日志：
```
Builtin commands registered               ← 无任何 warn，7 条命令全部就绪
```

---

## 最终打包命令

```bash
# 构建（单文件 CJS，所有依赖内联）
npx tsup

# 打包为 exe
npx pkg . --targets node20-win-x64 --output cehnzcode.exe
```

---

## 调试过程中踩过的坑

| 错误 | 原因 | 结论 |
|------|------|------|
| `MODULE_NOT_FOUND: openai/_shims/auto/runtime-node.js` | openai 是 ESM 优先包，内部 shim 用动态 require，pkg 静态分析追踪不到 | 改用 tsup noExternal 完全内联 |
| `pkg.json assets` 不生效 | JS 文件应放 `scripts` 而非 `assets`；且路径以 entry 目录为基准，不是 CWD | 注意 assets/scripts 区别 |
| `ZodError: apiKey Required` | dotenv 副作用导入在 pkg 中初始化顺序被打乱 | 在 config 模块内显式调用 `loadDotenv()` |
| `Cannot find module dist/lib/worker.js` | pino transport 启动 Worker 线程，Worker 路径在 snapshot 中不存在 | 改用 pino 同步 stderr |
| pkg 打包了旧 ESM 文件 | `package.json` 的 `main` 未更新为 `dist/index.cjs` | 保持 main/bin/build 输出三者一致 |
| 内置命令全部加载失败 | 动态 `import(file)` 在打包单文件后运行时路径失效 | 改为顶部静态 import，编译期内联 |
