import { validateJsonSchema, validateToolDefinition } from "./validator.js";
import type { ToolDefinition } from "../types.js";

console.log("=== Testing Tool Validator ===\n");

// 测试 1: 合法的工具定义
console.log("Test 1: Valid tool definition");
try {
  const validTool: ToolDefinition = {
    name: "test_tool",
    description: "A test tool",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input text" },
        count: { type: "number", description: "Count value" },
      },
      required: ["input"],
    },
    async execute(args) {
      return "test";
    },
  };
  validateToolDefinition(validTool);
  console.log("✓ Valid tool passed validation\n");
} catch (err) {
  console.error("✗ Unexpected error:", (err as Error).message, "\n");
}

// 测试 2: 缺少 name
console.log("Test 2: Missing name");
try {
  const invalidTool = {
    description: "A test tool",
    parameters: { type: "object", properties: {} },
    async execute() {
      return "test";
    },
  } as unknown as ToolDefinition;
  validateToolDefinition(invalidTool);
  console.error("✗ Should have thrown error\n");
} catch (err) {
  console.log("✓ Caught expected error:", (err as Error).message, "\n");
}

// 测试 3: 缺少 parameters.type
console.log("Test 3: Missing parameters.type");
try {
  const invalidTool: ToolDefinition = {
    name: "bad_tool",
    description: "A bad tool",
    parameters: { properties: {} } as any,
    async execute() {
      return "test";
    },
  };
  validateToolDefinition(invalidTool);
  console.error("✗ Should have thrown error\n");
} catch (err) {
  console.log("✓ Caught expected error:", (err as Error).message, "\n");
}

// 测试 4: object 类型缺少 properties
console.log("Test 4: Object type missing properties");
try {
  const invalidTool: ToolDefinition = {
    name: "bad_tool",
    description: "A bad tool",
    parameters: { type: "object" } as any,
    async execute() {
      return "test";
    },
  };
  validateToolDefinition(invalidTool);
  console.error("✗ Should have thrown error\n");
} catch (err) {
  console.log("✓ Caught expected error:", (err as Error).message, "\n");
}

// 测试 5: required 字段引用了不存在的 property
console.log("Test 5: Required field not in properties");
try {
  const invalidTool: ToolDefinition = {
    name: "bad_tool",
    description: "A bad tool",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input", "nonexistent"],
    },
    async execute() {
      return "test";
    },
  };
  validateToolDefinition(invalidTool);
  console.error("✗ Should have thrown error\n");
} catch (err) {
  console.log("✓ Caught expected error:", (err as Error).message, "\n");
}

// 测试 6: property 缺少 type
console.log("Test 6: Property missing type");
try {
  const invalidTool: ToolDefinition = {
    name: "bad_tool",
    description: "A bad tool",
    parameters: {
      type: "object",
      properties: {
        input: { description: "Input text" } as any,
      },
    },
    async execute() {
      return "test";
    },
  };
  validateToolDefinition(invalidTool);
  console.error("✗ Should have thrown error\n");
} catch (err) {
  console.log("✓ Caught expected error:", (err as Error).message, "\n");
}

console.log("=== All tests completed ===");
