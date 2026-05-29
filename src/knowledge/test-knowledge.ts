/**
 * 错题本模块完整测试
 * 运行方式：tsx src/knowledge/test-knowledge.ts
 *
 * 覆盖范围：
 *   - storage 层：generateId、路径生成、readStore/writeStore/appendRecord
 *   - 提示词：formatRecordsForPrompt、formatRecordsForDisplay、注入指令
 *   - KnowledgeManager：record()、getAll()、search()、isEnabled/setEnabled、resetPending
 *   - Hook tool:after：错误检测、flag 置位与清除、禁用时透传
 *   - Hook model:before：工具过滤、内容注入、自动超时（>5次）、大数据集摘要注入（>20条）
 */

// 必须在所有 import 之前设置环境变量（防止 getConfig() 在静态 import 期间被调用）
process.env.API_KEY = "test-key";
process.env.API_BASE_URL = "https://api.test.com/v1";
process.env.MODEL = "test-model";
process.env.MAX_TOKENS = "4096";
process.env.CONTEXT_LIMIT = "100000";
process.env.COMPRESS_KEEP_TURNS = "3";
process.env.TOOL_TIMEOUT = "30000";
process.env.LOG_LEVEL = "error";
process.env.SESSION_DIR = "./.sessions";

import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import {
  generateId,
  getSystemStorePath,
  getProjectStorePath,
  readStore,
  writeStore,
  appendRecord,
} from "./storage.js";
import {
  KNOWLEDGE_INJECTION_INSTRUCTION,
  formatRecordsForPrompt,
  formatRecordsForDisplay,
} from "../prompts/knowledge.js";
import type { KnowledgeRecord, RecordKnowledgeArgs } from "./types.js";
import type { Turn, ToolDefinition, ToolCall, ToolResult } from "../types.js";

// KnowledgeManager 使用动态导入，确保 env 已就绪（单例在模块加载时调用 getConfig()）
const { knowledgeManager } = await import("./index.js");
const { hookRunner } = await import("../hooks/index.js");

// ──────────────────────────────────────────────
// 测试计数器
// ──────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────

/** 创建一个最小合法的 system Turn */
function makeSystemTurn(content: string): Turn {
  return {
    id: "sys-turn",
    role: "system",
    content,
    tags: [],
    tokenCount: 0,
    compressed: false,
    timestamp: Date.now(),
  };
}

/** 创建一个 ToolDefinition stub */
function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    async execute() { return ""; },
  };
}

// 项目级知识库文件路径（tests 会写这里，最后清理）
const projectKnowledgePath = getProjectStorePath(process.cwd());

async function clearProjectKnowledge(): Promise<void> {
  await fs.rm(projectKnowledgePath, { force: true }).catch(() => {});
}

// ======================================================
// Part 1 — storage 层
// ======================================================

// ── 1. generateId ──────────────────────────────────────────────────
console.log("\nTest 1: generateId");
{
  const id1 = generateId();
  const id2 = generateId();
  assert(id1.startsWith("err_"), "ID 以 err_ 开头");
  assert(id1.length >= 10, "ID 长度合理");
  assert(id1 !== id2, "连续两次 ID 不同");
}

// ── 2. 路径生成 ────────────────────────────────────────────────────
console.log("\nTest 2: storage paths");
{
  const sysPath = getSystemStorePath();
  const projPath = getProjectStorePath(process.cwd());
  assert(sysPath.includes(".cehnzcode"), "系统路径包含 .cehnzcode");
  assert(sysPath.endsWith("errors.json"), "系统路径以 errors.json 结尾");
  assert(projPath.includes(".cehnzcode"), "项目路径包含 .cehnzcode");
  assert(projPath.startsWith(process.cwd()), "项目路径以 cwd 开头");
  assert(sysPath !== projPath, "系统路径与项目路径不同");
}

// ── 3. readStore（文件不存在时返回空 store）─────────────────────────
console.log("\nTest 3: readStore (non-existent file)");
{
  const tmpPath = path.join(os.tmpdir(), `knowledge-test-${Date.now()}.json`);
  const empty = await readStore(tmpPath);
  assert(empty.version === "1.0", "默认版本号 1.0");
  assert(Array.isArray(empty.errors), "errors 是数组");
  assert(empty.errors.length === 0, "初始 errors 为空");
}

// ── 4. writeStore + readStore ──────────────────────────────────────
console.log("\nTest 4: writeStore + readStore");
{
  const tmpPath = path.join(os.tmpdir(), `knowledge-test-${Date.now()}.json`);
  const rec: KnowledgeRecord = {
    id: generateId(),
    timestamp: Date.now(),
    scope: "project",
    error: "Cannot find module 'test'",
    background: "测试背景",
    solution: "pnpm add test",
    outcome: "recorded",
  };
  await writeStore(tmpPath, { version: "1.0", errors: [rec] });
  const read = await readStore(tmpPath);
  assert(read.errors.length === 1, "写入后读取到 1 条记录");
  assert(read.errors[0].id === rec.id, "ID 匹配");
  assert(read.errors[0].error === rec.error, "error 内容匹配");
  assert(read.errors[0].outcome === "recorded", "outcome 匹配");
  await fs.unlink(tmpPath).catch(() => {});
}

// ── 5. appendRecord ────────────────────────────────────────────────
console.log("\nTest 5: appendRecord");
{
  const tmpDir = path.join(os.tmpdir(), `knowledge-test-dir-${Date.now()}`);
  const rec1: KnowledgeRecord = {
    id: generateId(),
    timestamp: Date.now(),
    scope: "project",
    error: "error A",
    background: "bg A",
    solution: "sol A",
    outcome: "recorded",
  };
  const rec2: KnowledgeRecord = {
    id: generateId(),
    timestamp: Date.now(),
    scope: "project",
    error: "error B",
    background: "bg B",
    solution: "sol B",
    outcome: "unsolvable",
  };
  // appendRecord 以 tmpDir 作为 cwd，写到 tmpDir/.cehnzcode/knowledge/errors.json
  await appendRecord(rec1, "project", tmpDir);
  const after1 = await readStore(getProjectStorePath(tmpDir));
  assert(after1.errors.length === 1, "appendRecord 第一次写入后有 1 条");
  assert(after1.errors[0].id === rec1.id, "写入记录 ID 正确");

  await appendRecord(rec2, "project", tmpDir);
  const after2 = await readStore(getProjectStorePath(tmpDir));
  assert(after2.errors.length === 2, "appendRecord 第二次追加后有 2 条（不覆盖）");
  assert(after2.errors[1].id === rec2.id, "第二条记录 ID 正确");

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

// ── 6. 提示词格式化 ───────────────────────────────────────────────
console.log("\nTest 6: prompt formatters");
{
  assert(KNOWLEDGE_INJECTION_INSTRUCTION.length > 0, "注入指令非空");
  assert(KNOWLEDGE_INJECTION_INSTRUCTION.includes("record_knowledge"), "注入指令含 record_knowledge");
  assert(KNOWLEDGE_INJECTION_INSTRUCTION.includes("outcome"), "注入指令含 outcome 说明");

  const recs: KnowledgeRecord[] = [
    {
      id: "e1",
      timestamp: 0,
      scope: "system",
      error: "err-text",
      background: "bg-text",
      solution: "sol-text",
      outcome: "recorded",
    },
  ];

  const promptText = formatRecordsForPrompt(recs);
  assert(promptText.includes("err-text"), "formatRecordsForPrompt 含错误内容");
  assert(promptText.includes("bg-text"), "formatRecordsForPrompt 含背景");
  assert(promptText.includes("sol-text"), "formatRecordsForPrompt 含解法");
  assert(promptText.includes("[system]"), "formatRecordsForPrompt 含 scope 标签");

  const displayText = formatRecordsForDisplay(recs);
  assert(displayText.includes("err-text"), "formatRecordsForDisplay 含错误内容");
  assert(displayText.includes("recorded"), "formatRecordsForDisplay 含 outcome");

  const emptyDisplay = formatRecordsForDisplay([]);
  assert(emptyDisplay.includes("暂无记录"), "空记录时显示提示文本");
}

// ======================================================
// Part 2 — KnowledgeManager 接口
// ======================================================

// 清空项目级知识库，防止前次测试残留影响计数
await clearProjectKnowledge();

// ── 7. record() ────────────────────────────────────────────────────
console.log("\nTest 7: KnowledgeManager.record()");
{
  // skipped 不写盘，返回 null
  const r1 = await knowledgeManager.record({
    scope: "project",
    error: "known error",
    background: "bg",
    solution: "skip me",
    outcome: "skipped",
  });
  assert(r1 === null, "outcome=skipped → 返回 null");

  const storeAfterSkip = await readStore(projectKnowledgePath);
  assert(storeAfterSkip.errors.length === 0, "outcome=skipped → 不写磁盘");

  // recorded 写盘，返回记录对象
  const r2 = await knowledgeManager.record({
    scope: "project",
    error: "new error",
    background: "bg2",
    solution: "sol2",
    outcome: "recorded",
  });
  assert(r2 !== null, "outcome=recorded → 返回记录");
  assert(r2!.id.startsWith("err_"), "返回记录 id 以 err_ 开头");
  assert(r2!.error === "new error", "返回记录 error 字段正确");
  assert(r2!.outcome === "recorded", "返回记录 outcome 字段正确");

  const storeAfterRecord = await readStore(projectKnowledgePath);
  assert(storeAfterRecord.errors.length === 1, "outcome=recorded → 写入磁盘");

  // unsolvable 写盘，返回记录对象
  const r3 = await knowledgeManager.record({
    scope: "project",
    error: "hard error",
    background: "bg3",
    solution: "tried A, tried B",
    outcome: "unsolvable",
  });
  assert(r3 !== null, "outcome=unsolvable → 返回记录");
  assert(r3!.outcome === "unsolvable", "返回记录 outcome=unsolvable");

  const storeAfterUnsolvable = await readStore(projectKnowledgePath);
  assert(storeAfterUnsolvable.errors.length === 2, "outcome=unsolvable → 写入磁盘");

  // 不同调用生成不同 ID
  const r4 = await knowledgeManager.record({
    scope: "project",
    error: "another",
    background: "bg4",
    solution: "sol4",
    outcome: "recorded",
  });
  assert(r4!.id !== r2!.id, "不同调用 ID 唯一");
}

// ── 8. getAll() ────────────────────────────────────────────────────
console.log("\nTest 8: KnowledgeManager.getAll()");
{
  // 当前项目文件有 3 条（来自 test 7）
  const all = await knowledgeManager.getAll();
  // getAll 合并系统级 + 项目级；只验证项目级的存在，不断言总数（避免受系统文件影响）
  const projectRecords = all.filter((r) => r.scope === "project");
  assert(projectRecords.length >= 3, "getAll() 包含项目级记录（至少来自 test7 的 3 条）");

  // 写入后立即可检索
  const uniqueError = `unique-error-${Date.now()}`;
  await knowledgeManager.record({
    scope: "project",
    error: uniqueError,
    background: "bg-unique",
    solution: "sol-unique",
    outcome: "recorded",
  });
  const all2 = await knowledgeManager.getAll();
  const found = all2.some((r) => r.error === uniqueError);
  assert(found, "record() 后 getAll() 能立即检索到新记录");
}

// ── 9. search() ────────────────────────────────────────────────────
console.log("\nTest 9: KnowledgeManager.search()");
{
  // 写入带特殊标记的测试数据
  const marker = `search-test-${Date.now()}`;
  await knowledgeManager.record({
    scope: "project",
    error: `${marker}-in-error`,
    background: "neutral-bg",
    solution: "neutral-sol",
    outcome: "recorded",
  });
  await knowledgeManager.record({
    scope: "project",
    error: "neutral-error",
    background: `${marker}-in-bg`,
    solution: "neutral-sol",
    outcome: "recorded",
  });
  await knowledgeManager.record({
    scope: "project",
    error: "neutral-error-2",
    background: "neutral-bg-2",
    solution: `${marker}-in-sol`,
    outcome: "recorded",
  });

  // 按 error 字段匹配
  const r1 = await knowledgeManager.search(`${marker}-in-error`);
  assert(r1.length >= 1, "按 error 字段搜索有结果");
  assert(r1.some((r) => r.error.includes(`${marker}-in-error`)), "搜索结果 error 含关键词");

  // 按 background 字段匹配
  const r2 = await knowledgeManager.search(`${marker}-in-bg`);
  assert(r2.length >= 1, "按 background 字段搜索有结果");

  // 按 solution 字段匹配
  const r3 = await knowledgeManager.search(`${marker}-in-sol`);
  assert(r3.length >= 1, "按 solution 字段搜索有结果");

  // 大小写不敏感
  const r4 = await knowledgeManager.search(marker.toUpperCase());
  assert(r4.length >= 3, "搜索大小写不敏感（匹配所有三条）");

  // 无匹配返回空
  const r5 = await knowledgeManager.search("no-match-xyz-9999");
  assert(r5.length === 0, "无匹配时返回空数组");

  // limit 参数
  const r6 = await knowledgeManager.search(marker, 2);
  assert(r6.length <= 2, "limit 参数限制最大返回数");
}

// ── 10. isEnabled / setEnabled ────────────────────────────────────
console.log("\nTest 10: isEnabled / setEnabled");
{
  // 默认启用（config 中 knowledgeEnabled 默认为 true）
  assert(knowledgeManager.isEnabled() === true, "初始状态：enabled=true");

  knowledgeManager.setEnabled(false);
  assert(knowledgeManager.isEnabled() === false, "setEnabled(false) → isEnabled() false");

  knowledgeManager.setEnabled(true);
  assert(knowledgeManager.isEnabled() === true, "setEnabled(true) → isEnabled() true");
}

// ── 11. resetPending ──────────────────────────────────────────────
console.log("\nTest 11: resetPending");
{
  // 触发 pendingInjection，然后重置，验证 model:before 不再注入
  const failCall: ToolCall = { id: "x", name: "bash", arguments: {} };
  const failResult: ToolResult = { callId: "x", output: "", error: "fail" };

  await hookRunner.run("tool:after", { call: failCall, result: failResult });

  // model:before 此时应该有注入
  const beforeReset = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("prompt")],
    tools: [],
  });
  const injectedBefore =
    !beforeReset.cancelled &&
    (beforeReset.data.messages[0] as Turn).content.includes("错题本");
  assert(injectedBefore, "resetPending 前：model:before 有注入");

  // 重置 pending 状态
  knowledgeManager.resetPending();

  const afterReset = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("prompt")],
    tools: [],
  });
  const injectedAfter =
    !afterReset.cancelled &&
    (afterReset.data.messages[0] as Turn).content.includes("错题本");
  assert(!injectedAfter, "resetPending 后：model:before 不再注入");
}

// ======================================================
// Part 3 — Hook 行为
// ======================================================

// ── 12. hook: tool:after ──────────────────────────────────────────
console.log("\nTest 12: hook - tool:after");
{
  // 确保干净状态
  knowledgeManager.resetPending();
  knowledgeManager.setEnabled(true);

  const bashFail: ToolCall = { id: "1", name: "bash", arguments: {} };
  const failResult: ToolResult = { callId: "1", output: "", error: "exit code 1" };
  const successResult: ToolResult = { callId: "1", output: "ok" };
  const recCall: ToolCall = { id: "2", name: "record_knowledge", arguments: {} };
  const recResult: ToolResult = { callId: "2", output: "done" };

  // 12-1: 工具失败 → model:before 注入
  await hookRunner.run("tool:after", { call: bashFail, result: failResult });
  const r1 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("sys")],
    tools: [],
  });
  assert(
    !r1.cancelled && (r1.data.messages[0] as Turn).content.includes("错题本"),
    "工具执行失败 → pendingInjection=true → model:before 有注入"
  );

  // 12-2: record_knowledge 调用 → 清除 flag，model:before 不再注入
  await hookRunner.run("tool:after", { call: recCall, result: recResult });
  const r2 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("sys")],
    tools: [],
  });
  const content2 = !r2.cancelled ? (r2.data.messages[0] as Turn).content : "";
  assert(content2 === "sys", "record_knowledge 调用后 pendingInjection=false → 不注入");

  // 12-3: 功能禁用时工具失败不设置 flag
  knowledgeManager.setEnabled(false);
  await hookRunner.run("tool:after", { call: bashFail, result: failResult });
  knowledgeManager.setEnabled(true);

  const r3 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("sys")],
    tools: [],
  });
  const content3 = !r3.cancelled ? (r3.data.messages[0] as Turn).content : "";
  assert(content3 === "sys", "功能禁用时工具失败不设置 flag");

  // 12-4: 工具成功（无 error 字段）不设置 flag
  await hookRunner.run("tool:after", { call: bashFail, result: successResult });
  const r4 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("sys")],
    tools: [],
  });
  const content4 = !r4.cancelled ? (r4.data.messages[0] as Turn).content : "";
  assert(content4 === "sys", "工具成功时不设置 pendingInjection");
}

// ── 13. hook: model:before ────────────────────────────────────────
console.log("\nTest 13: hook - model:before");
{
  knowledgeManager.resetPending();
  knowledgeManager.setEnabled(true);

  const recTool = makeTool("record_knowledge");
  const searchTool = makeTool("search_knowledge");
  const bashTool = makeTool("bash");

  // 13-1: 禁用时过滤知识库工具，保留其他工具
  knowledgeManager.setEnabled(false);
  const r1 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("sys")],
    tools: [recTool, searchTool, bashTool],
  });
  assert(!r1.cancelled, "禁用时 model:before 不取消");
  if (!r1.cancelled) {
    const names = r1.data.tools.map((t) => t.name);
    assert(!names.includes("record_knowledge"), "禁用时 record_knowledge 被过滤");
    assert(!names.includes("search_knowledge"), "禁用时 search_knowledge 被过滤");
    assert(names.includes("bash"), "禁用时 bash 工具保留");
  }
  knowledgeManager.setEnabled(true);

  // 13-2: 启用且 pendingInjection=false → 不修改 messages
  const r2 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("base prompt")],
    tools: [],
  });
  const content2 = !r2.cancelled ? (r2.data.messages[0] as Turn).content : "";
  assert(content2 === "base prompt", "pendingInjection=false 时不修改 messages");

  // 13-3: pendingInjection=true → 注入内容追加到系统提示词末尾
  await hookRunner.run("tool:after", {
    call: { id: "t1", name: "bash", arguments: {} },
    result: { callId: "t1", output: "", error: "fail" },
  });
  const r3 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("base prompt")],
    tools: [],
  });
  assert(!r3.cancelled, "pendingInjection=true 时不取消");
  if (!r3.cancelled) {
    const content = (r3.data.messages[0] as Turn).content;
    assert(content.startsWith("base prompt"), "注入追加在原内容之后");
    assert(content.includes("错题本"), "注入包含 '错题本' 标题");
    assert(content.includes("record_knowledge"), "注入包含 record_knowledge 指令");
  }

  // 13-4: 无 system 消息时不崩溃
  const userTurn: Turn = {
    id: "u1",
    role: "user",
    content: "hello",
    tags: [],
    tokenCount: 0,
    compressed: false,
    timestamp: Date.now(),
  };
  const r4 = await hookRunner.run("model:before", {
    messages: [userTurn],
    tools: [],
  });
  assert(!r4.cancelled, "无 system 消息时 model:before 不崩溃");

  // 清除 pending 状态
  knowledgeManager.resetPending();
}

// ── 14. 自动超时（>5 次模型调用自动清除）──────────────────────────
console.log("\nTest 14: 自动超时（pendingCallCount > 5）");
{
  knowledgeManager.resetPending();

  // 触发 pending
  await hookRunner.run("tool:after", {
    call: { id: "t1", name: "bash", arguments: {} },
    result: { callId: "t1", output: "", error: "fail" },
  });

  // 运行 6 次 model:before，记录每次是否注入
  const injected: boolean[] = [];
  for (let i = 1; i <= 6; i++) {
    const r = await hookRunner.run("model:before", {
      messages: [makeSystemTurn("sys")],
      tools: [],
    });
    if (!r.cancelled) {
      const content = (r.data.messages[0] as Turn).content;
      injected.push(content.includes("错题本"));
    }
  }

  // pendingCallCount++ 后与 5 比较：1~5 注入，第 6 次 count=6>5 清除不注入
  const injectCount = injected.filter(Boolean).length;
  assert(injectCount === 5, `超时前注入了 ${injectCount} 次（期望 5 次）`);
  assert(injected[5] === false, "第 6 次调用触发超时，不再注入");

  // 第 7 次：pending 已清除，不再注入
  const r7 = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("sys")],
    tools: [],
  });
  const content7 = !r7.cancelled ? (r7.data.messages[0] as Turn).content : "";
  assert(!content7.includes("错题本"), "超时后第 7 次不再注入");
}

// ── 15. 大数据集（>20 条）注入摘要格式 ────────────────────────────
console.log("\nTest 15: 大数据集（>20 条）注入摘要");
{
  knowledgeManager.resetPending();

  // 直接向项目文件写入 21 条记录（绕过 record() 以加速测试）
  const bigRecords: KnowledgeRecord[] = Array.from({ length: 21 }, (_, i) => ({
    id: `err_big_${i}`,
    timestamp: Date.now(),
    scope: "project" as const,
    error: `big-dataset-error-${i}`,
    background: `背景 ${i}`,
    solution: `解法 ${i}`,
    outcome: "recorded" as const,
  }));
  await writeStore(projectKnowledgePath, { version: "1.0", errors: bigRecords });

  // 触发 pending
  await hookRunner.run("tool:after", {
    call: { id: "t1", name: "bash", arguments: {} },
    result: { callId: "t1", output: "", error: "fail" },
  });

  // 传入包含 search_knowledge 的工具列表，避免动态 import 缺失文件的问题
  const r = await hookRunner.run("model:before", {
    messages: [makeSystemTurn("sys")],
    tools: [makeTool("search_knowledge")],
  });

  assert(!r.cancelled, "大数据集时 model:before 不取消");
  if (!r.cancelled) {
    const content = (r.data.messages[0] as Turn).content;
    assert(content.includes("摘要"), "大数据集使用摘要注入格式");
    assert(content.includes("search_knowledge"), "摘要注入含 search_knowledge 提示");
    // 摘要只列错误标题，不含详细背景
    assert(!content.includes("背景 0"), "摘要不包含详细背景字段");
  }

  knowledgeManager.resetPending();
}

// ======================================================
// 清理 & 最终结果
// ======================================================

await clearProjectKnowledge();

console.log(`\n${"─".repeat(40)}`);
console.log(`总计：${passed + failed} 项，通过 ${passed}，失败 ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("所有测试通过 ✓");
}
