import type { JsonSchema, ToolDefinition } from "../types.js";

// 延迟加载 logger，避免在测试环境中触发配置加载
let logger: ReturnType<typeof import("../logger/index.js").createChildLogger> | null = null;

function getLogger() {
  if (!logger) {
    // 动态导入 logger，只在实际需要时加载
    const { createChildLogger } = require("../logger/index.js");
    logger = createChildLogger("tool-validator");
  }
  return logger;
}

/**
 * 验证 JSON Schema 的基本结构是否合法
 * 确保 schema 符合 JSON Schema 规范的基本要求
 */
export function validateJsonSchema(schema: JsonSchema, toolName: string): void {
  // 检查必须的 type 字段
  if (!schema.type) {
    throw new Error(`Tool "${toolName}": parameters.type is required`);
  }

  // 检查 type 是否是合法值
  const validTypes = ["object", "string", "number", "boolean", "array", "null"];
  if (!validTypes.includes(schema.type)) {
    throw new Error(
      `Tool "${toolName}": parameters.type must be one of ${validTypes.join(", ")}`
    );
  }

  // 如果是 object 类型，检查 properties
  if (schema.type === "object") {
    if (!schema.properties || typeof schema.properties !== "object") {
      throw new Error(
        `Tool "${toolName}": parameters.properties is required when type is "object"`
      );
    }

    // 检查 required 字段（如果存在）
    if (schema.required) {
      if (!Array.isArray(schema.required)) {
        throw new Error(`Tool "${toolName}": parameters.required must be an array`);
      }

      // 检查 required 中的字段是否都在 properties 中定义
      for (const field of schema.required) {
        if (typeof field !== "string") {
          throw new Error(
            `Tool "${toolName}": parameters.required must contain only strings`
          );
        }
        if (!schema.properties[field]) {
          throw new Error(
            `Tool "${toolName}": required field "${field}" is not defined in properties`
          );
        }
      }
    }

    // 递归验证 properties 中的每个字段
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (typeof propSchema !== "object" || propSchema === null) {
        throw new Error(
          `Tool "${toolName}": property "${propName}" must be a valid schema object`
        );
      }

      const prop = propSchema as Record<string, unknown>;
      if (!prop.type) {
        throw new Error(
          `Tool "${toolName}": property "${propName}" must have a type field`
        );
      }
    }
  }

  // 如果是 array 类型，检查 items
  if (schema.type === "array") {
    if (!schema.items) {
      // 只在非测试环境下输出警告
      try {
        const log = getLogger();
        if (log) {
          log.warn(
            { tool: toolName },
            "Array type should define items schema for better validation"
          );
        }
      } catch {
        // 测试环境下忽略 logger 错误
      }
    }
  }
}

/**
 * 验证 ToolDefinition 的完整性
 * 确保工具定义包含所有必需字段且格式正确
 */
export function validateToolDefinition(tool: ToolDefinition): void {
  // 检查必需字段
  if (!tool.name || typeof tool.name !== "string") {
    throw new Error("Tool must have a valid name (non-empty string)");
  }

  if (!tool.description || typeof tool.description !== "string") {
    throw new Error(`Tool "${tool.name}": description is required (non-empty string)`);
  }

  if (!tool.parameters || typeof tool.parameters !== "object") {
    throw new Error(`Tool "${tool.name}": parameters is required (must be an object)`);
  }

  if (typeof tool.execute !== "function") {
    throw new Error(`Tool "${tool.name}": execute must be a function`);
  }

  // 验证 parameters 的 JSON Schema 结构
  validateJsonSchema(tool.parameters, tool.name);

  // 只在非测试环境下输出日志
  try {
    const log = getLogger();
    if (log) {
      log.debug({ tool: tool.name }, "Tool definition validated successfully");
    }
  } catch {
    // 测试环境下忽略 logger 错误
  }
}
