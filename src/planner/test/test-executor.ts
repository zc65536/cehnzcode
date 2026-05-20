/**
 * Phase 4 执行器测试
 *
 * 验证 PlanExecutor、NoteManager、DependencyGraphImpl 的核心逻辑。
 * 运行：tsx src/planner/test/test-executor.ts
 */

import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";

process.env.API_KEY = process.env.API_KEY || "test-key";
process.env.LOG_LEVEL = "error";

const { PlanExecutor } = await import("../executor.js");
const { NoteManager } = await import("../note-manager.js");
const { DependencyGraphImpl } = await import("../dependency-graph.js");
const { NoteValidator } = await import("../validator.js");

import type { AppConfig } from "../../types.js";
import type { TaskPlan, Module, ModuleNote, ValidationResult } from "../types.js";

/**
 * Phase 4 测试专用：始终通过的 NoteValidator。
 * 避免真实模型调用、磁盘 IO 和测试命令执行干扰 executor 的调度逻辑测试。
 */
class NoopNoteValidator extends NoteValidator {
  override async validateNote(): Promise<ValidationResult> {
    return { valid: true, issues: [] };
  }
  override async generateAndRunTests(): Promise<{ passed: boolean; testPaths: string[] }> { return { passed: true, testPaths: [] }; }
}

// ============ 工具函数 ============

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${name}`);
    console.error(`    ${msg}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

function makeModule(id: string, index: number, dependsOn: string[] = []): Module {
  return {
    id,
    name: `模块${index + 1}`,
    index,
    description: `模块 ${id} 的描述`,
    dependsOn,
    relatedModules: [],
    inputContract: [],
    outputContract: [{ name: `func_${id}`, description: `${id} 导出的函数` }],
    status: "pending",
  };
}

function makePlan(modules: Module[]): TaskPlan {
  return {
    id: "test-plan",
    task: "测试任务",
    description: "用于测试的计划",
    modules,
    status: "running",
    createdAt: Date.now(),
    metadata: { complexity: "simple", tags: [] },
  };
}

const testConfig: AppConfig = {
  apiKey: "test-key",
  apiBaseUrl: "https://api.example.com",
  model: "gpt-4",
  maxTokens: 4096,
  contextLimit: 100000,
  compressKeepTurns: 5,
  toolTimeout: 30000,
  logLevel: "error",
  sessionDir: "/tmp",
  pluginDirs: [],
};

// ============ DependencyGraphImpl 测试 ============

console.log("\n=== DependencyGraphImpl ===\n");

await test("getReadyModules 返回无依赖的 pending 模块", () => {
  const graph = new DependencyGraphImpl();
  const m1 = makeModule("module_001", 0, []);
  const m2 = makeModule("module_002", 1, ["module_001"]);
  graph.addModule(m1);
  graph.addModule(m2);

  const ready = graph.getReadyModules();
  assert(ready.length === 1, `expected 1 ready module, got ${ready.length}`);
  assert(ready[0].id === "module_001", `expected module_001, got ${ready[0].id}`);
});

await test("getReadyModules 在依赖完成后返回下游模块", () => {
  const graph = new DependencyGraphImpl();
  const m1 = makeModule("module_001", 0, []);
  const m2 = makeModule("module_002", 1, ["module_001"]);
  m1.status = "done";
  graph.addModule(m1);
  graph.addModule(m2);

  const ready = graph.getReadyModules();
  assert(ready.length === 1, `expected 1 ready module, got ${ready.length}`);
  assert(ready[0].id === "module_002", `expected module_002, got ${ready[0].id}`);
});

await test("getReadyModules 不返回 running/done 模块", () => {
  const graph = new DependencyGraphImpl();
  const m1 = makeModule("module_001", 0, []);
  m1.status = "running";
  graph.addModule(m1);

  const ready = graph.getReadyModules();
  assert(ready.length === 0, `expected 0 ready modules, got ${ready.length}`);
});

await test("getExecutionOrder 返回正确的拓扑顺序", () => {
  const graph = new DependencyGraphImpl();
  // m1 → m2 → m3（链式依赖）
  graph.addModule(makeModule("module_001", 0, []));
  graph.addModule(makeModule("module_002", 1, ["module_001"]));
  graph.addModule(makeModule("module_003", 2, ["module_002"]));

  const order = graph.getExecutionOrder();
  assert(order.length === 3, `expected 3 modules, got ${order.length}`);

  // 拓扑排序：module_001 必须在 module_002 之前，module_002 必须在 module_003 之前
  const idx1 = order.indexOf("module_001");
  const idx2 = order.indexOf("module_002");
  const idx3 = order.indexOf("module_003");
  assert(idx1 < idx2, `module_001 should come before module_002`);
  assert(idx2 < idx3, `module_002 should come before module_003`);
});

await test("hasCircularDependency 检测环路", () => {
  const graph = new DependencyGraphImpl();
  // A 依赖 B，B 依赖 A
  graph.addModule(makeModule("module_001", 0, ["module_002"]));
  graph.addModule(makeModule("module_002", 1, ["module_001"]));

  assert(graph.hasCircularDependency(), "should detect circular dependency");
});

await test("hasCircularDependency 在无环路时返回 false", () => {
  const graph = new DependencyGraphImpl();
  graph.addModule(makeModule("module_001", 0, []));
  graph.addModule(makeModule("module_002", 1, ["module_001"]));

  assert(!graph.hasCircularDependency(), "should not detect circular dependency");
});

// ============ NoteManager 测试 ============

console.log("\n=== NoteManager ===\n");

const tmpDir = path.join(os.tmpdir(), `cehnzcode-test-${Date.now()}`);
const noteManager = new NoteManager(tmpDir);

const testModule = makeModule("module_001", 0);
const testNote: ModuleNote = {
  files: [
    { path: "src/auth/jwt.ts", description: "JWT 工具函数" },
  ],
  exports: [
    { name: "generateToken", description: "生成 JWT token" },
    { name: "verifyToken", description: "验证 JWT token" },
  ],
  envVars: ["JWT_SECRET"],
  extra: { dependencies: "jsonwebtoken@9.0.0" },
};

await test("saveNote 创建 JSON 和 Markdown 文件", async () => {
  await noteManager.saveNote(testModule, testNote);

  const jsonPath = path.join(tmpDir, "module_001.json");
  const mdPath = path.join(tmpDir, "module_001.md");

  await fs.access(jsonPath);
  await fs.access(mdPath);
});

await test("loadNote 读取已保存的笔记", async () => {
  const note = await noteManager.loadNote("module_001");
  assert(note !== null, "note should not be null");
  assert(note!.files.length === 1, `expected 1 file, got ${note!.files.length}`);
  assert(note!.exports.length === 2, `expected 2 exports, got ${note!.exports.length}`);
  assert(note!.envVars?.[0] === "JWT_SECRET", "envVars should contain JWT_SECRET");
});

await test("loadNote 对不存在的模块返回 null", async () => {
  const note = await noteManager.loadNote("nonexistent_module");
  assert(note === null, "should return null for missing module");
});

await test("loadNotes 批量读取多个笔记", async () => {
  // 先保存第二个笔记
  const m2 = makeModule("module_002", 1);
  const n2: ModuleNote = { files: [], exports: [] };
  await noteManager.saveNote(m2, n2);

  const notes = await noteManager.loadNotes(["module_001", "module_002", "missing"]);
  assert(notes.size === 2, `expected 2 notes, got ${notes.size}`);
  assert(notes.has("module_001"), "should have module_001");
  assert(notes.has("module_002"), "should have module_002");
  assert(!notes.has("missing"), "should not have missing");
});

await test("saveNote 生成的 Markdown 包含模块信息", async () => {
  const mdPath = path.join(tmpDir, "module_001.md");
  const content = await fs.readFile(mdPath, "utf-8");
  assert(content.includes("module_001"), "markdown should contain module id");
  assert(content.includes("generateToken"), "markdown should contain export names");
  assert(content.includes("JWT_SECRET"), "markdown should contain env vars");
});

// 清理临时目录
await fs.rm(tmpDir, { recursive: true, force: true });

// ============ PlanExecutor 测试 ============

console.log("\n=== PlanExecutor ===\n");

await test("execute 按依赖顺序执行两个模块", async () => {
  // 模拟两次 agentic loop + 两次笔记生成
  // 调用顺序：m1 执行(agentic) → m1 笔记生成 → m2 执行(agentic) → m2 笔记生成
  let callCount = 0;
  const mockModel = {
    chat: async () => {
      callCount++;
      const noteJson = JSON.stringify({
        files: [{ path: `src/mod${callCount}.ts`, description: "模块文件" }],
        exports: [{ name: `func${callCount}`, description: "导出函数" }],
      });
      // 偶数次调用（笔记生成）返回 JSON，奇数次（agentic loop）返回无工具调用的完成响应
      return {
        content: callCount % 2 === 0 ? noteJson : "实现完成",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
      };
    },
  };

  const plan = makePlan([
    makeModule("module_001", 0, []),
    makeModule("module_002", 1, ["module_001"]),
  ]);

  const executor = new PlanExecutor(mockModel as any, testConfig, new NoopNoteValidator());
  const results: any[] = [];

  for await (const result of executor.execute(plan)) {
    results.push(result);
  }

  assert(results.length === 2, `expected 2 results, got ${results.length}`);
  assert(results[0].moduleId === "module_001", `first result should be module_001`);
  assert(results[1].moduleId === "module_002", `second result should be module_002`);
  assert(results[0].status === "done", `module_001 should be done`);
  assert(results[1].status === "done", `module_002 should be done`);
});

await test("execute 在无依赖模块时并行执行", async () => {
  const execOrder: string[] = [];
  const mockModel = {
    chat: async (_turns: any) => {
      return {
        content: JSON.stringify({ files: [], exports: [] }),
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
      };
    },
  };

  // 三个模块都无依赖，应并行执行
  const plan = makePlan([
    makeModule("module_001", 0, []),
    makeModule("module_002", 1, []),
    makeModule("module_003", 2, []),
  ]);

  const executor = new PlanExecutor(mockModel as any, testConfig, new NoopNoteValidator());
  const results: any[] = [];

  for await (const result of executor.execute(plan)) {
    results.push(result);
  }

  assert(results.length === 3, `expected 3 results, got ${results.length}`);
  // 所有模块都应完成
  for (const r of results) {
    assert(r.status === "done", `${r.moduleId} should be done, got ${r.status}`);
  }
});

await test("execute 在依赖失败时跳过下游模块", async () => {
  let callCount = 0;
  const mockModel = {
    chat: async () => {
      callCount++;
      // 只有第一次（module_001 执行）失败
      if (callCount === 1) {
        throw new Error("模拟执行失败");
      }
      return {
        content: JSON.stringify({ files: [], exports: [] }),
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "stop",
      };
    },
  };

  const plan = makePlan([
    makeModule("module_001", 0, []),
    makeModule("module_002", 1, ["module_001"]),
  ]);

  const executor = new PlanExecutor(mockModel as any, testConfig, new NoopNoteValidator());
  const results: any[] = [];

  for await (const result of executor.execute(plan)) {
    results.push(result);
  }

  // module_001 失败，module_002 被跳过（不 yield 结果）
  const failedResult = results.find(r => r.moduleId === "module_001");
  assert(failedResult?.status === "failed", "module_001 should be failed");

  const skippedModule = plan.modules.find(m => m.id === "module_002");
  assert(skippedModule?.status === "skipped", "module_002 should be skipped");
});

await test("pause 和 resume 控制执行", async () => {
  const executor = new PlanExecutor({} as any, testConfig, new NoopNoteValidator());
  executor.pause();
  executor.resume();
  // 不抛出错误即通过
});

await test("cancel 设置取消标志", async () => {
  const executor = new PlanExecutor({} as any, testConfig, new NoopNoteValidator());
  executor.cancel();
  // 不抛出错误即通过
});

// ============ 汇总 ============

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);

if (failed > 0) {
  process.exit(1);
}
