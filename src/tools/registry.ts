import type { ToolDefinition } from "../types.js";
import { createChildLogger } from "../logger/index.js";
import { validateToolDefinition } from "./validator.js";

const logger = createChildLogger("tool-registry");

/**
 * 工具注册表
 * 负责管理所有可用的工具定义，提供注册、查询、删除等功能
 * 在注册时会自动验证工具定义的合法性，确保 JSON Schema 格式正确
 */
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  // 防抖：记录最近注册的工具和时间戳，避免短时间内重复注册
  private recentRegistrations = new Map<string, number>();
  private readonly debounceMs = 100; // 100ms 内的重复注册会被忽略

  /**
   * 注册一个工具
   * 会自动验证工具定义的完整性和 JSON Schema 的合法性
   * 如果工具已存在会发出警告并覆盖
   */
  register(tool: ToolDefinition): void {
    // 防抖检查：如果在短时间内重复注册同一个工具，直接忽略
    const now = Date.now();
    const lastRegistered = this.recentRegistrations.get(tool.name);
    if (lastRegistered && now - lastRegistered < this.debounceMs) {
      logger.debug(
        { tool: tool.name, debounceMs: this.debounceMs },
        "Ignoring duplicate registration within debounce window"
      );
      return;
    }

    // 验证工具定义的合法性
    try {
      validateToolDefinition(tool);
    } catch (err) {
      const error = err as Error;
      logger.error({ tool: tool.name, error: error.message }, "Tool validation failed");
      throw error;
    }

    // 检查是否覆盖已有工具
    if (this.tools.has(tool.name)) {
      logger.warn({ tool: tool.name }, "Overwriting existing tool");
    }

    // 注册工具并记录时间戳
    this.tools.set(tool.name, tool);
    this.recentRegistrations.set(tool.name, now);
    logger.debug({ tool: tool.name }, "Tool registered");
  }

  /**
   * 批量注册多个工具
   * 如果某个工具验证失败，会记录错误但继续注册其他工具
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      try {
        this.register(tool);
      } catch (err) {
        const error = err as Error;
        logger.error(
          { tool: tool.name, error: error.message },
          "Failed to register tool, skipping"
        );
      }
    }
  }

  /**
   * 获取指定名称的工具定义
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有已注册的工具定义
   */
  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * 获取所有工具的 schema 信息，用于传递给 AI 模型
   */
  getSchemas(): { name: string; description: string; parameters: unknown }[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /**
   * 检查指定名称的工具是否已注册
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 移除指定名称的工具
   * 返回 true 表示成功移除，false 表示工具不存在
   */
  remove(name: string): boolean {
    this.recentRegistrations.delete(name);
    return this.tools.delete(name);
  }

  /**
   * 清空所有已注册的工具
   */
  clear(): void {
    this.tools.clear();
    this.recentRegistrations.clear();
  }
}

export const toolRegistry = new ToolRegistry();
