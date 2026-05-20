/**
 * Phase 2 讨论会话测试
 *
 * 验证 PlanDiscussionSessionImpl 的核心逻辑：
 * - [READY_TO_PLAN] 标记检测与去除
 * - history 累积
 * - getHistory 正确排除 system 消息
 *
 * 运行：LOG_LEVEL=error npx tsx src/planner/test/test-discussion.ts
 */

process.env.LOG_LEVEL = "error";
process.env.API_KEY = process.env.API_KEY ?? "test-key";

import type { AppConfig } from "../../types.js";
import { PlanDiscussionSessionImpl } from "../discussion.js";
import { READY_MARKER } from "../types.js";
import { ModelClient } from "../../model/index.js";

// ============ 简单测试框架 ============

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

// ============ Mock ModelClient ============

function makeMockModel(replies: string[]): ModelClient {
  let callIndex = 0;

  // 返回一个结构上与 ModelClient 兼容的 mock 对象
  return {
    chat: async (_turns: unknown, _tools: unknown) => {
      const content = replies[callIndex] ?? "（无更多回复）";
      callIndex++;
      return {
        content,
        toolCalls: [],
        usage: { prompt: 0, completion: 0, total: 0 },
        finishReason: "stop",
      };
    },
    chatStream: () => {
      throw new Error("chatStream not mocked");
    },
  } as unknown as ModelClient;
}

// ============ 测试套件 ============

console.log("\n=== Phase 2: PlanDiscussionSession 测试 ===\n");

// --- 初始状态 ---

console.log("初始状态：");

await test("history 初始为空数组", () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel([]), {});
  assert(Array.isArray(session.history), "history should be array");
  assert(session.history.length === 0, `history should be empty, got ${session.history.length}`);
});

await test("startedAt 为正数时间戳", () => {
  const before = Date.now();
  const session = new PlanDiscussionSessionImpl(makeMockModel([]), {});
  const after = Date.now();
  assert(session.startedAt >= before, "startedAt too early");
  assert(session.startedAt <= after, "startedAt too late");
});

await test("getHistory 初始返回空数组", () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel([]), {});
  const h = session.getHistory();
  assert(Array.isArray(h), "getHistory should return array");
  assert(h.length === 0, "getHistory should be empty initially");
});

// --- send() 基本行为 ---

console.log("\nsend() 基本行为：");

await test("send 返回模型回复内容", async () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel(["你好，我会帮你规划。"]), {});
  const result = await session.send("我想做一个功能", {});
  assert(result.reply === "你好，我会帮你规划。", `unexpected reply: ${result.reply}`);
});

await test("send 后 history 含 user 和 assistant 消息", async () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel(["回复1"]), {});
  await session.send("输入1", {});
  assert(session.history.length === 2, `expected 2 history items, got ${session.history.length}`);
  assert(session.history[0].role === "user", "first should be user");
  assert(session.history[1].role === "assistant", "second should be assistant");
});

await test("多轮 send 累积 history", async () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel(["回复1", "回复2"]), {});
  await session.send("问题1", {});
  await session.send("问题2", {});
  assert(session.history.length === 4, `expected 4, got ${session.history.length}`);
  assert(session.history[0].content === "问题1", "history[0] should be 问题1");
  assert(session.history[1].content === "回复1", "history[1] should be 回复1");
  assert(session.history[2].content === "问题2", "history[2] should be 问题2");
  assert(session.history[3].content === "回复2", "history[3] should be 回复2");
});

// --- getHistory 不含 system ---

console.log("\ngetHistory 正确性：");

await test("getHistory 不含 system 提示词", async () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel(["回复"]), {});
  await session.send("输入", {});
  const h = session.getHistory();
  const hasSystem = h.some(m => m.role === "system");
  assert(!hasSystem, "getHistory should not contain system messages");
});

await test("getHistory 返回 history 副本，修改不影响内部状态", async () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel(["回复"]), {});
  await session.send("输入", {});
  const h = session.getHistory();
  h.push({ role: "user", content: "注入" });
  assert(session.history.length === 2, "internal history should not be affected");
});

// --- [READY_TO_PLAN] 标记检测 ---

console.log("\n[READY_TO_PLAN] 标记检测：");

await test("末尾标记 → readyToPlan = true", async () => {
  const reply = `总结如下。\n\n${READY_MARKER}`;
  const session = new PlanDiscussionSessionImpl(makeMockModel([reply]), {});
  const result = await session.send("开始吧", {});
  assert(result.readyToPlan === true, "should detect READY_TO_PLAN");
});

await test("末尾标记被从 reply 中移除", async () => {
  const reply = `总结如下。\n\n${READY_MARKER}`;
  const session = new PlanDiscussionSessionImpl(makeMockModel([reply]), {});
  const result = await session.send("开始吧", {});
  assert(!result.reply.includes(READY_MARKER), "marker should be removed from reply");
  assert(result.reply.trim() === "总结如下。", `unexpected reply: "${result.reply}"`);
});

await test("标记也不出现在 history 里（getHistory 返回的历史不含标记）", async () => {
  const reply = `总结如下。\n\n${READY_MARKER}`;
  const session = new PlanDiscussionSessionImpl(makeMockModel([reply]), {});
  await session.send("开始吧", {});
  const h = session.getHistory();
  for (const msg of h) {
    assert(!msg.content.includes(READY_MARKER), `history message should not contain marker: ${msg.content}`);
  }
});

await test("标记在中间 → readyToPlan = false", async () => {
  const reply = `我们讨论一下 ${READY_MARKER} 这个标记的用法。继续...`;
  const session = new PlanDiscussionSessionImpl(makeMockModel([reply]), {});
  const result = await session.send("继续", {});
  assert(result.readyToPlan === false, "marker in middle should not trigger");
});

await test("无标记 → readyToPlan = false", async () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel(["普通回复，没有标记"]), {});
  const result = await session.send("问题", {});
  assert(result.readyToPlan === false, "no marker → readyToPlan should be false");
});

await test("标记前有空白字符也能检测到", async () => {
  const reply = `总结。   ${READY_MARKER}   `;
  const session = new PlanDiscussionSessionImpl(makeMockModel([reply]), {});
  const result = await session.send("开始吧", {});
  assert(result.readyToPlan === true, "should detect marker with surrounding whitespace");
});

// --- projectInstructions 注入 ---

console.log("\nprojectInstructions 注入：");

await test("构造时传入 projectInstructions 不报错", () => {
  const session = new PlanDiscussionSessionImpl(makeMockModel([]), {
    projectInstructions: "这是项目规范",
  });
  assert(session.history.length === 0, "history should still be empty");
});

// ============ 结果 ============

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
if (failed > 0) process.exit(1);
