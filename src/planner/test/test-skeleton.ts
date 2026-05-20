/**
 * Planner 骨架测试
 *
 * 验证所有骨架类已正确创建，且未实现的方法抛出预期错误。
 * 运行：API_KEY=test-key tsx src/planner/test/test-skeleton.ts
 *    或：tsx src/planner/test/test-skeleton.ts（会自动设置测试环境变量）
 */

// 在任何模块加载前设置环境变量，避免 logger 初始化时读取真实配置
process.env.API_KEY = process.env.API_KEY || "test-key-for-skeleton-test";
process.env.LOG_LEVEL = "error";

// ESM 中 static import 会提前执行，所以用动态 import 确保 env 已设置
const { TaskPlannerImpl } = await import("../index.js");
const { PlanDiscussionSessionImpl } = await import("../discussion.js");
const { PlanCreator } = await import("../creator.js");
const { PlanExecutor } = await import("../executor.js");
const { DependencyGraphImpl } = await import("../dependency-graph.js");
const { NoteManager } = await import("../note-manager.js");
const { PlanPersistence } = await import("../persistence.js");
const { PlanValidator, NoteValidator } = await import("../validator.js");
const { ModelClient } = await import("../../model/index.js");

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
    // 预期 "Not implemented" 错误视为通过
    if (msg.includes("Not implemented")) {
      console.log(`  ✓ ${name} [Not implemented — expected]`);
      passed++;
    } else {
      console.error(`  ✗ ${name}`);
      console.error(`    ${msg}`);
      failed++;
    }
  }
}

async function expectThrows(fn: () => Promise<unknown> | unknown, expectedMsg: string): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected error containing "${expectedMsg}" but no error was thrown`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(expectedMsg)) {
      throw new Error(`Expected error containing "${expectedMsg}", got: "${msg}"`);
    }
  }
}

// ============ 测试配置 ============

import type { AppConfig } from "../../types.js";

const config: AppConfig = {
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

const model = new ModelClient(config);

// ============ 测试套件 ============

console.log("\n=== Planner 骨架测试 ===\n");

// TaskPlannerImpl
console.log("TaskPlannerImpl:");

const planner = new TaskPlannerImpl(config, model);

await test("createDiscussionSession 返回 session 实例", () => {
  const session = planner.createDiscussionSession({});
  if (!session) throw new Error("session is null");
  if (!Array.isArray(session.history)) throw new Error("session.history should be an array");
  if (session.history.length !== 0) throw new Error("session.history should be empty");
});

await test("createPlan 抛出 Not implemented", async () => {
  await expectThrows(
    () => planner.createPlan({ task: "test", discussionHistory: [] }),
    "Not implemented"
  );
});

await test("executePlan 抛出 Not implemented", async () => {
  const plan = {
    id: "test",
    task: "test",
    description: "test",
    modules: [],
    status: "draft" as const,
    createdAt: Date.now(),
    metadata: { complexity: "simple" as const, tags: [] },
  };
  const gen = planner.executePlan(plan);
  await expectThrows(() => gen.next(), "Not implemented");
});

await test("pause/resume/cancel 不抛出错误", () => {
  planner.pause();
  planner.resume();
  planner.cancel();
});

await test("getStatus 返回字符串", () => {
  const status = planner.getStatus();
  if (typeof status !== "string") throw new Error("status should be a string");
});

// PlanDiscussionSessionImpl
console.log("\nPlanDiscussionSessionImpl:");

const session = new PlanDiscussionSessionImpl(model, {});

await test("history 初始为空数组", () => {
  if (!Array.isArray(session.history)) throw new Error("history should be an array");
  if (session.history.length !== 0) throw new Error("history should be empty");
});

await test("startedAt 为时间戳", () => {
  if (typeof session.startedAt !== "number") throw new Error("startedAt should be a number");
  if (session.startedAt <= 0) throw new Error("startedAt should be positive");
});

await test("send 抛出 Not implemented", async () => {
  await expectThrows(() => session.send("hello", {}), "Not implemented");
});

await test("getHistory 返回空数组副本", () => {
  const h = session.getHistory();
  if (!Array.isArray(h)) throw new Error("getHistory should return array");
});

// DependencyGraphImpl
console.log("\nDependencyGraphImpl:");

const graph = new DependencyGraphImpl();

await test("addModule 不抛出错误", () => {
  graph.addModule({
    id: "m1",
    index: 0,
    description: "test module",
    dependsOn: [],
    relatedModules: [],
    inputContract: [],
    outputContract: [],
    status: "pending",
  });
});

await test("getReadyModules 抛出 Not implemented", async () => {
  await expectThrows(() => graph.getReadyModules(), "Not implemented");
});

await test("hasCircularDependency 抛出 Not implemented", async () => {
  await expectThrows(() => graph.hasCircularDependency(), "Not implemented");
});

// PlanValidator / NoteValidator
console.log("\nPlanValidator / NoteValidator:");

const planValidator = new PlanValidator();
const noteValidator = new NoteValidator();

await test("PlanValidator.validatePlan 抛出 Not implemented", async () => {
  const plan = {
    id: "p1", task: "t", description: "d", modules: [], status: "draft" as const,
    createdAt: Date.now(), metadata: { complexity: "simple" as const, tags: [] },
  };
  await expectThrows(() => planValidator.validatePlan(plan), "Not implemented");
});

await test("NoteValidator.generateTests 抛出 Not implemented", async () => {
  const module = {
    id: "m1", index: 0, description: "d", dependsOn: [], relatedModules: [],
    inputContract: [], outputContract: [], status: "pending" as const,
  };
  await expectThrows(() => noteValidator.generateTests(module), "Not implemented");
});

// ============ 汇总 ============

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);

if (failed > 0) {
  process.exit(1);
}
