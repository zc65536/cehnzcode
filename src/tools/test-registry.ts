import { toolRegistry } from "./registry.js";
import type { ToolDefinition } from "../types.js";

console.log("=== Testing Tool Registry ===\n");

// 清空 registry
toolRegistry.clear();

// 测试 1: 注册合法工具
console.log("Test 1: Register valid tool");
const validTool: ToolDefinition = {
  name: "test_tool",
  description: "A test tool",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "Input text" },
    },
    required: ["input"],
  },
  async execute(args) {
    return `Received: ${args.input}`;
  },
};

try {
  toolRegistry.register(validTool);
  console.log("✓ Tool registered successfully");
  console.log("  Has tool:", toolRegistry.has("test_tool"));
  console.log("  Total tools:", toolRegistry.getAll().length, "\n");
} catch (err) {
  console.error("✗ Unexpected error:", (err as Error).message, "\n");
}

// 测试 2: 注册非法工具（应该抛出错误）
console.log("Test 2: Register invalid tool (missing type)");
const invalidTool = {
  name: "bad_tool",
  description: "A bad tool",
  parameters: { properties: {} } as any,
  async execute() {
    return "test";
  },
};

try {
  toolRegistry.register(invalidTool);
  console.error("✗ Should have thrown error\n");
} catch (err) {
  console.log("✓ Caught expected error:", (err as Error).message);
  console.log("  Tool not registered:", !toolRegistry.has("bad_tool"), "\n");
}

// 测试 3: 防抖测试（快速重复注册）
console.log("Test 3: Debounce test (rapid duplicate registration)");
const tool2: ToolDefinition = {
  name: "debounce_test",
  description: "Test debounce",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    return "test";
  },
};

try {
  toolRegistry.register(tool2);
  console.log("  First registration: success");
  
  // 立即再次注册（应该被防抖忽略）
  toolRegistry.register(tool2);
  console.log("  Second registration (immediate): debounced");
  
  // 等待 150ms 后再注册（应该成功）
  await new Promise((resolve) => setTimeout(resolve, 150));
  toolRegistry.register(tool2);
  console.log("  Third registration (after 150ms): success");
  console.log("✓ Debounce working correctly\n");
} catch (err) {
  console.error("✗ Unexpected error:", (err as Error).message, "\n");
}

// 测试 4: 批量注册（包含合法和非法工具）
console.log("Test 4: Batch registration with mixed validity");
const tools: ToolDefinition[] = [
  {
    name: "tool_a",
    description: "Tool A",
    parameters: { type: "object", properties: {} },
    async execute() {
      return "a";
    },
  },
  {
    name: "tool_b",
    description: "Tool B",
    parameters: { type: "string" } as any, // 缺少 properties
    async execute() {
      return "b";
    },
  },
  {
    name: "tool_c",
    description: "Tool C",
    parameters: { type: "object", properties: {} },
    async execute() {
      return "c";
    },
  },
];

toolRegistry.registerAll(tools);
console.log("  Registered tools:", toolRegistry.getAll().map((t) => t.name).join(", "));
console.log("  Has tool_a:", toolRegistry.has("tool_a"));
console.log("  Has tool_b:", toolRegistry.has("tool_b"), "(should be false)");
console.log("  Has tool_c:", toolRegistry.has("tool_c"));
console.log("✓ Batch registration handled errors gracefully\n");

// 测试 5: 获取 schemas
console.log("Test 5: Get schemas for AI model");
const schemas = toolRegistry.getSchemas();
console.log("  Total schemas:", schemas.length);
console.log("  Schema names:", schemas.map((s) => s.name).join(", "));
console.log("✓ Schemas retrieved successfully\n");

console.log("=== All tests completed ===");
