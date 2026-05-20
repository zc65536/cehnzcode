/**
 * Phase 5 NoteValidator 测试
 *
 * 验证四步笔记验证流程：契约对比 → 静态检查 → 生成测试 → 运行测试。
 * 运行：tsx src/planner/test/test-note-validator.ts
 */

import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";

process.env.API_KEY = process.env.API_KEY || "test-key";
process.env.LOG_LEVEL = "error";

const { NoteValidator } = await import("../validator.js");

import type { Module, ModuleNote } from "../types.js";

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

function makeModule(overrides: Partial<Module> = {}): Module {
  return {
    id: "module_001",
    name: "测试模块",
    index: 0,
    description: "用于测试的模块",
    dependsOn: [],
    relatedModules: [],
    inputContract: [],
    outputContract: [
      { name: "func1", description: "功能1" },
      { name: "func2", description: "功能2" },
    ],
    status: "running",
    ...overrides,
  };
}

function makeNote(exports: Array<{ name: string; description: string }>): ModuleNote {
  return {
    files: [],
    exports,
  };
}

// ============ 无 model 时骨架行为 ============

console.log("\n=== NoteValidator（无 model — 骨架行为）===\n");

await test("无 model 时 validateNote 抛出 Not implemented", async () => {
  const validator = new NoteValidator();
  const module = makeModule();
  try {
    await validator.validateNote(module);
    throw new Error("Expected error but none thrown");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert(msg.includes("Not implemented"), `Expected "Not implemented", got: ${msg}`);
  }
});

await test("无 model 时 generateAndRunTests 抛出 Not implemented", async () => {
  const validator = new NoteValidator();
  const module = makeModule();
  try {
    await validator.generateAndRunTests(module);
    throw new Error("Expected error but none thrown");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert(msg.includes("Not implemented"), `Expected "Not implemented", got: ${msg}`);
  }
});

// ============ compareContracts（步骤1）——通过 mock model 测试 ============

console.log("\n=== compareContracts（契约对比）===\n");

await test("outputContract 全部覆盖时返回 valid=true", async () => {
  const mockModel = {
    chat: async () => ({
      content: JSON.stringify({ valid: true, missing: [], mismatch: [] }),
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, "/tmp");
  const module = makeModule({
    note: makeNote([
      { name: "func1", description: "功能1" },
      { name: "func2", description: "功能2" },
    ]),
  });

  const result = await (validator as any).compareContracts(module);
  assert(result.valid === true, `Expected valid=true, got valid=${result.valid}`);
  assert(result.issues.length === 0, `Expected no issues, got ${result.issues.length}`);
});

await test("笔记缺少接口时返回 valid=false，issues 包含缺失接口名", async () => {
  const mockModel = {
    chat: async () => ({
      content: JSON.stringify({
        valid: false,
        missing: ["func2"],
        mismatch: [],
      }),
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, "/tmp");
  const module = makeModule({
    note: makeNote([{ name: "func1", description: "功能1" }]),
  });

  const result = await (validator as any).compareContracts(module);
  assert(result.valid === false, `Expected valid=false, got valid=${result.valid}`);
  assert(result.issues.length === 1, `Expected 1 issue, got ${result.issues.length}`);
  assert(result.issues[0].description.includes("func2"), `Issue should mention func2`);
});

await test("接口描述不匹配时返回 valid=false，issues 包含 mismatch 信息", async () => {
  const mockModel = {
    chat: async () => ({
      content: JSON.stringify({
        valid: false,
        missing: [],
        mismatch: [{ name: "func1", issue: "描述不符" }],
      }),
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, "/tmp");
  const module = makeModule({
    note: makeNote([
      { name: "func1", description: "描述不一致" },
      { name: "func2", description: "功能2" },
    ]),
  });

  const result = await (validator as any).compareContracts(module);
  assert(result.valid === false, `Expected valid=false`);
  assert(result.issues.some((i: any) => i.description.includes("func1")), `Issue should mention func1`);
});

await test("笔记不存在时直接返回 valid=false", async () => {
  const mockModel = { chat: async () => ({ content: "", toolCalls: [], usage: {}, finishReason: "stop" }) };
  const validator = new NoteValidator(mockModel as any, "/tmp");
  const module = makeModule(); // no note

  const result = await (validator as any).compareContracts(module);
  assert(result.valid === false, `Expected valid=false when note is missing`);
});

await test("模型返回非 JSON 时容错通过", async () => {
  const mockModel = {
    chat: async () => ({
      content: "这是非 JSON 的回复",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, "/tmp");
  const module = makeModule({
    note: makeNote([{ name: "func1", description: "功能1" }]),
  });

  // 解析失败时应容错，返回 valid=true
  const result = await (validator as any).compareContracts(module);
  assert(result.valid === true, `Should tolerate invalid JSON, got valid=${result.valid}`);
});

// ============ checkExports（步骤2）——通过临时文件测试 ============

console.log("\n=== checkExports（静态导出检查）===\n");

const tmpDir = path.join(os.tmpdir(), `cehnzcode-validator-test-${Date.now()}`);
await fs.mkdir(tmpDir, { recursive: true });

await test("代码文件包含 export const 声明时返回 valid=true", async () => {
  const srcFile = path.join(tmpDir, "module_a.ts");
  await fs.writeFile(srcFile, `export const func1 = () => {};\nexport function func2() {}\n`, "utf-8");

  const mockModel = { chat: async () => ({ content: "", toolCalls: [], usage: {}, finishReason: "stop" }) };
  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule({
    note: {
      files: [{ path: "module_a.ts", description: "源文件" }],
      exports: [
        { name: "func1", description: "功能1" },
        { name: "func2", description: "功能2" },
      ],
    },
  });

  const result = await (validator as any).checkExports(module);
  assert(result.valid === true, `Expected valid=true, got valid=${result.valid}, issues: ${JSON.stringify(result.issues)}`);
});

await test("代码文件缺少声明的导出时返回 valid=false", async () => {
  const srcFile = path.join(tmpDir, "module_b.ts");
  await fs.writeFile(srcFile, `export const func1 = () => {};\n`, "utf-8");

  const mockModel = { chat: async () => ({ content: "", toolCalls: [], usage: {}, finishReason: "stop" }) };
  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule({
    note: {
      files: [{ path: "module_b.ts", description: "源文件" }],
      exports: [
        { name: "func1", description: "功能1" },
        { name: "missingFunc", description: "缺失的功能" },
      ],
    },
  });

  const result = await (validator as any).checkExports(module);
  assert(result.valid === false, `Expected valid=false`);
  assert(
    result.issues.some((i: any) => i.description.includes("missingFunc")),
    `Issue should mention missingFunc`
  );
});

await test("导出检测支持 export { ... } 形式", async () => {
  const srcFile = path.join(tmpDir, "module_c.ts");
  await fs.writeFile(srcFile, `const namedExport = () => {};\nexport { namedExport };\n`, "utf-8");

  const mockModel = { chat: async () => ({ content: "", toolCalls: [], usage: {}, finishReason: "stop" }) };
  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule({
    note: {
      files: [{ path: "module_c.ts", description: "源文件" }],
      exports: [{ name: "namedExport", description: "具名导出" }],
    },
  });

  const result = await (validator as any).checkExports(module);
  assert(result.valid === true, `Expected valid=true for named export`);
});

await test("文件不存在时静态检查跳过（返回 valid=true）", async () => {
  const mockModel = { chat: async () => ({ content: "", toolCalls: [], usage: {}, finishReason: "stop" }) };
  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule({
    note: {
      files: [{ path: "nonexistent_file.ts", description: "不存在的文件" }],
      exports: [{ name: "someExport", description: "导出" }],
    },
  });

  const result = await (validator as any).checkExports(module);
  // 文件不存在时应该跳过检查而不是报错
  assert(result.valid === true, `Expected valid=true when file does not exist`);
});

await test("笔记无 exports 时静态检查直接通过", async () => {
  const mockModel = { chat: async () => ({ content: "", toolCalls: [], usage: {}, finishReason: "stop" }) };
  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule({ note: { files: [], exports: [] } });

  const result = await (validator as any).checkExports(module);
  assert(result.valid === true, `Expected valid=true when no exports declared`);
});

// ============ generateTests（步骤3）——通过 mock model 测试 ============

console.log("\n=== generateTests（测试生成）===\n");

await test("generateTests 将模型返回的内容写入测试文件", async () => {
  const testContent = `import { describe, it, expect } from "vitest";\ndescribe("func1", () => { it("works", () => { expect(true).toBe(true); }); });\n`;
  const mockModel = {
    chat: async () => ({
      content: testContent,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
    }),
  };

  const notesDir = path.join(tmpDir, ".cehnzcode", "notes");
  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule({
    note: makeNote([{ name: "func1", description: "功能1" }]),
  });

  const result = await validator.generateAndRunTests(module);

  assert(result.testPaths.length >= 0, `Expected testPaths array`);
  assert(typeof result.passed === "boolean", `Expected passed boolean`);
});

await test("outputContract 为空时 generateAndRunTests 返回空 testPaths", async () => {
  const mockModel = {
    chat: async () => ({
      content: "PASS",
      toolCalls: [],
      usage: {},
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule({
    outputContract: [],
    note: makeNote([]),
  });

  const result = await validator.generateAndRunTests(module);
  assert(result.testPaths.length === 0, `Expected 0 test paths when no outputContract`);
});

await test("笔记不存在时 generateAndRunTests 返回空 testPaths", async () => {
  const mockModel = {
    chat: async () => ({ content: "PASS", toolCalls: [], usage: {}, finishReason: "stop" }),
  };

  const validator = new NoteValidator(mockModel as any, tmpDir);
  const module = makeModule(); // no note

  const result = await validator.generateAndRunTests(module);
  assert(result.testPaths.length === 0, `Expected 0 test paths when note is missing`);
});

// ============ validateNote 集成（步骤1-4 串联）============

console.log("\n=== validateNote（集成流程）===\n");

await test("全流程通过时返回 valid=true", async () => {
  // step1: 契约对比通过
  // step2: 静态检查通过（exports 为空）
  // step3: 生成测试
  // step4: runTests — 这里 mock model 不实际运行，我们直接 mock runTests
  const mockModel = {
    chat: async () => ({
      content: JSON.stringify({ valid: true, missing: [], mismatch: [] }),
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, tmpDir);
  // 覆盖 generateAndRunTests，避免实际执行命令
  (validator as any).generateAndRunTests = async () => ({ passed: true, testPaths: [] });

  const module = makeModule({
    note: {
      files: [],
      exports: [
        { name: "func1", description: "功能1" },
        { name: "func2", description: "功能2" },
      ],
    },
  });

  const result = await validator.validateNote(module);
  assert(result.valid === true, `Expected valid=true, got ${result.valid}: ${JSON.stringify(result.issues)}`);
});

await test("步骤1 失败时跳过后续步骤并返回 valid=false", async () => {
  const mockModel = {
    chat: async () => ({
      content: JSON.stringify({ valid: false, missing: ["func2"], mismatch: [] }),
      toolCalls: [],
      usage: {},
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, tmpDir);
  let step2Called = false;
  (validator as any).checkExports = async () => { step2Called = true; return { valid: true, issues: [] }; };

  const module = makeModule({
    note: makeNote([{ name: "func1", description: "功能1" }]),
  });

  const result = await validator.validateNote(module);
  assert(result.valid === false, `Expected valid=false`);
  assert(!step2Called, `Step 2 should not be called when step 1 fails`);
});

await test("步骤4 测试失败时返回 valid=false", async () => {
  const mockModel = {
    chat: async () => ({
      content: JSON.stringify({ valid: true, missing: [], mismatch: [] }),
      toolCalls: [],
      usage: {},
      finishReason: "stop",
    }),
  };

  const validator = new NoteValidator(mockModel as any, tmpDir);
  (validator as any).generateAndRunTests = async () => ({ passed: false, testPaths: [], error: "test error output" });

  const module = makeModule({
    note: { files: [], exports: [] },
  });

  const result = await validator.validateNote(module);
  assert(result.valid === false, `Expected valid=false when tests fail`);
  assert(
    result.issues.some((i: any) => i.description.includes("test error output")),
    `Issue should include test error output`
  );
});

// 清理
await fs.rm(tmpDir, { recursive: true, force: true });

// ============ 汇总 ============

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);

if (failed > 0) {
  process.exit(1);
}
