/**
 * Phase 3 测试：PlanCreator 和 PlanValidator
 *
 * 测试计划生成、验证、重试等核心逻辑。
 * 运行：tsx src/planner/test/test-creator.ts
 */

process.env.API_KEY = process.env.API_KEY || "test-key-for-creator-test";
process.env.LOG_LEVEL = "error";

const { PlanCreator } = await import("../creator.js");
const { PlanValidator } = await import("../validator.js");
const { DependencyGraphImpl } = await import("../dependency-graph.js");

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

function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(`${msg ?? "Assertion failed"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayLength(arr: unknown[], expected: number, msg?: string): void {
  if (arr.length !== expected) {
    throw new Error(`${msg ?? "Length mismatch"}: expected ${expected}, got ${arr.length}`);
  }
}

// ============ 模拟 Model ============

/** 构造固定返回值序列的 mock model */
function makeMockModel(responses: string[]): any {
  let callIndex = 0;
  return {
    chat: async (_turns: unknown, _tools: unknown) => {
      if (callIndex >= responses.length) {
        throw new Error(`Unexpected model call (index ${callIndex}, only ${responses.length} responses configured)`);
      }
      return { content: responses[callIndex++], toolCalls: [], usage: { prompt: 0, completion: 0, total: 0 }, finishReason: "stop" };
    },
    callCount: () => callIndex,
  };
}

const SIMPLE_PLAN_JSON = JSON.stringify({
  description: "一个简单的测试任务",
  modules: [
    {
      description: "模块一：提供基础功能",
      dependsOn: [],
      relatedModules: [],
      inputContract: [],
      outputContract: [{ name: "baseFunc", description: "基础功能函数" }],
    },
    {
      description: "模块二：使用基础功能",
      dependsOn: [0],
      relatedModules: [0],
      inputContract: [{ name: "baseFunc", description: "基础功能函数", sourceModule: "module_001" }],
      outputContract: [{ name: "advancedFunc", description: "高级功能函数" }],
    },
  ],
  metadata: { estimatedDuration: 20, complexity: "simple", tags: ["test"] },
});

const VALID_RESULT_JSON = JSON.stringify({ valid: true, issues: [] });
const INVALID_RESULT_JSON = JSON.stringify({
  valid: false,
  issues: [{ type: "missing_provider", description: "缺少提供方", modules: [0] }],
});

// ============ DependencyGraphImpl 测试 ============

console.log("\n=== DependencyGraphImpl 测试 ===\n");

await test("空图不存在循环依赖", () => {
  const graph = new DependencyGraphImpl();
  assertEqual(graph.hasCircularDependency(), false, "empty graph");
});

await test("线性依赖链无循环", () => {
  const graph = new DependencyGraphImpl();
  graph.addModule({ id: "m1", index: 0, description: "", dependsOn: [], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  graph.addModule({ id: "m2", index: 1, description: "", dependsOn: ["m1"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  graph.addModule({ id: "m3", index: 2, description: "", dependsOn: ["m2"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  assertEqual(graph.hasCircularDependency(), false, "linear chain");
});

await test("直接自环检测为循环", () => {
  const graph = new DependencyGraphImpl();
  graph.addModule({ id: "m1", index: 0, description: "", dependsOn: ["m1"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  assertEqual(graph.hasCircularDependency(), true, "self-loop");
});

await test("两节点互相依赖检测为循环", () => {
  const graph = new DependencyGraphImpl();
  graph.addModule({ id: "m1", index: 0, description: "", dependsOn: ["m2"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  graph.addModule({ id: "m2", index: 1, description: "", dependsOn: ["m1"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  assertEqual(graph.hasCircularDependency(), true, "mutual dependency");
});

await test("三节点环路检测为循环", () => {
  const graph = new DependencyGraphImpl();
  graph.addModule({ id: "m1", index: 0, description: "", dependsOn: ["m3"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  graph.addModule({ id: "m2", index: 1, description: "", dependsOn: ["m1"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  graph.addModule({ id: "m3", index: 2, description: "", dependsOn: ["m2"], relatedModules: [], inputContract: [], outputContract: [], status: "pending" });
  assertEqual(graph.hasCircularDependency(), true, "3-node cycle");
});

// ============ PlanValidator（纯代码验证）测试 ============

console.log("\n=== PlanValidator 测试（不使用 model）===\n");

function makePlan(modules: any[]): any {
  return {
    id: "test-plan",
    task: "测试任务",
    description: "测试计划",
    modules,
    status: "draft",
    createdAt: Date.now(),
    metadata: { complexity: "simple", tags: [] },
  };
}

function makeModule(id: string, index: number, overrides: any = {}): any {
  return {
    id, index, description: "test",
    dependsOn: [], relatedModules: [],
    inputContract: [], outputContract: [],
    status: "pending", ...overrides,
  };
}

await test("空模块列表验证通过", async () => {
  const validator = new PlanValidator();
  const result = await validator.validatePlan(makePlan([]));
  assertEqual(result.valid, true);
  assertArrayLength(result.issues, 0);
});

await test("正常依赖关系验证通过", async () => {
  const validator = new PlanValidator();
  const plan = makePlan([
    makeModule("module_001", 0, { outputContract: [{ name: "funcA", description: "A" }] }),
    makeModule("module_002", 1, {
      dependsOn: ["module_001"],
      inputContract: [{ name: "funcA", description: "A", sourceModule: "module_001" }],
    }),
  ]);
  const result = await validator.validatePlan(plan);
  assertEqual(result.valid, true);
});

await test("缺少接口提供方报错", async () => {
  const validator = new PlanValidator();
  const plan = makePlan([
    makeModule("module_001", 0, {
      inputContract: [{ name: "missingFunc", description: "不存在的接口" }],
    }),
  ]);
  const result = await validator.validatePlan(plan);
  assertEqual(result.valid, false);
  assertEqual(result.issues[0].type, "missing_provider");
});

await test("循环依赖报错", async () => {
  const validator = new PlanValidator();
  const plan = makePlan([
    makeModule("module_001", 0, { dependsOn: ["module_002"] }),
    makeModule("module_002", 1, { dependsOn: ["module_001"] }),
  ]);
  const result = await validator.validatePlan(plan);
  assertEqual(result.valid, false);
  assertEqual(result.issues[0].type, "circular_dependency");
});

// ============ PlanCreator 测试 ============

console.log("\n=== PlanCreator 测试 ===\n");

await test("直接模式：从任务描述生成计划", async () => {
  const model = makeMockModel([SIMPLE_PLAN_JSON, VALID_RESULT_JSON]);
  const creator = new PlanCreator(model, {} as any);

  const plan = await creator.create({ task: "实现一个简单功能", discussionHistory: [] });

  assertEqual(plan.status, "draft");
  assertArrayLength(plan.modules, 2);
  assertEqual(plan.modules[0].id, "module_001");
  assertEqual(plan.modules[1].id, "module_002");
  // dependsOn 应该已转换为 ID
  assertArrayLength(plan.modules[1].dependsOn, 1);
  assertEqual(plan.modules[1].dependsOn[0], "module_001");
});

await test("讨论模式：从讨论历史生成计划", async () => {
  const model = makeMockModel([SIMPLE_PLAN_JSON, VALID_RESULT_JSON]);
  const creator = new PlanCreator(model, {} as any);

  const plan = await creator.create({
    task: null,
    discussionHistory: [
      { role: "user", content: "我想实现一个功能" },
      { role: "assistant", content: "好的，请详细描述" },
      { role: "user", content: "就是一个简单的测试" },
    ],
  });

  assertArrayLength(plan.modules, 2);
  assertEqual(plan.status, "draft");
});

await test("验证失败时自动重试", async () => {
  // 第1次生成 → 验证失败 → 第2次生成 → 验证通过
  const model = makeMockModel([
    SIMPLE_PLAN_JSON,   // 第1次生成
    INVALID_RESULT_JSON, // 第1次验证：失败
    SIMPLE_PLAN_JSON,   // 第2次生成（带反馈）
    VALID_RESULT_JSON,  // 第2次验证：通过
  ]);
  const creator = new PlanCreator(model, {} as any);

  const plan = await creator.create({ task: "测试重试", discussionHistory: [] });

  assertArrayLength(plan.modules, 2);
  assertEqual(model.callCount(), 4, "应该调用了4次 model.chat");
});

await test("JSON 包裹在代码块中可正确解析", async () => {
  const wrappedJson = `\`\`\`json\n${SIMPLE_PLAN_JSON}\n\`\`\``;
  const model = makeMockModel([wrappedJson, VALID_RESULT_JSON]);
  const creator = new PlanCreator(model, {} as any);

  const plan = await creator.create({ task: "测试JSON解析", discussionHistory: [] });
  assertArrayLength(plan.modules, 2);
});

await test("超过最大重试次数抛出错误", async () => {
  // 3次生成都验证失败
  const model = makeMockModel([
    SIMPLE_PLAN_JSON, INVALID_RESULT_JSON,
    SIMPLE_PLAN_JSON, INVALID_RESULT_JSON,
    SIMPLE_PLAN_JSON, INVALID_RESULT_JSON,
  ]);
  const creator = new PlanCreator(model, {} as any);

  try {
    await creator.create({ task: "始终失败的任务", discussionHistory: [] });
    throw new Error("应该抛出错误但没有");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("验证失败")) {
      throw new Error(`错误消息不符合预期：${msg}`);
    }
  }
});

await test("计划 ID 格式正确", async () => {
  const model = makeMockModel([SIMPLE_PLAN_JSON, VALID_RESULT_JSON]);
  const creator = new PlanCreator(model, {} as any);

  const plan = await creator.create({ task: "测试ID格式", discussionHistory: [] });

  if (!/^plan_\d{8}_[a-z0-9]{6}$/.test(plan.id)) {
    throw new Error(`计划 ID 格式不符合预期：${plan.id}`);
  }
});

await test("模块索引正确映射", async () => {
  const model = makeMockModel([SIMPLE_PLAN_JSON, VALID_RESULT_JSON]);
  const creator = new PlanCreator(model, {} as any);

  const plan = await creator.create({ task: "测试索引映射", discussionHistory: [] });

  assertEqual(plan.modules[0].index, 0);
  assertEqual(plan.modules[1].index, 1);
  // relatedModules 也应该转换为 ID
  assertEqual(plan.modules[1].relatedModules[0], "module_001");
});

// ============ 汇总 ============

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);

if (failed > 0) {
  process.exit(1);
}
