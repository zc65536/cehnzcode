import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { z } from "zod";
import { createChildLogger } from "../logger/index.js";
import type { MCPConfig, MCPServerConfig } from "./types.js";

// 延迟创建 logger，避免在模块加载时触发配置加载
let logger: ReturnType<typeof createChildLogger> | null = null;
function getLogger() {
  if (!logger) {
    logger = createChildLogger("mcp-config");
  }
  return logger;
}

// Zod schema for validation
const MCPServerConfigSchema = z.object({
  transport: z.enum(["stdio", "sse"]).default("stdio"),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
  disabled: z.boolean().optional(),
  autoApprove: z.array(z.string()).optional(),
});

const MCPConfigSchema = z.object({
  mcpServers: z.record(MCPServerConfigSchema),
});

/**
 * MCP 配置管理器
 * 负责读取/写入系统级和项目级配置文件，实现配置合并策略
 */
export class MCPConfigManager {
  private systemConfigPath: string;
  private projectConfigPath: string | null;

  constructor(projectRoot?: string) {
    // 系统级配置路径：~/.cehnzcode/mcp.json
    this.systemConfigPath = path.join(os.homedir(), ".cehnzcode", "mcp.json");

    // 项目级配置路径：<project>/.cehnzcode/mcp.json
    this.projectConfigPath = projectRoot
      ? path.join(projectRoot, ".cehnzcode", "mcp.json")
      : null;
  }

  /**
   * 加载并合并系统级和项目级配置
   * 项目级配置会覆盖系统级配置（字段级深度合并）
   */
  async loadMergedConfig(): Promise<MCPConfig> {
    const systemConfig = await this.loadConfig(this.systemConfigPath);
    const projectConfig = this.projectConfigPath
      ? await this.loadConfig(this.projectConfigPath)
      : { mcpServers: {} };

    // 合并配置
    const merged: MCPConfig = { mcpServers: {} };

    // 先添加系统级配置
    for (const [name, config] of Object.entries(systemConfig.mcpServers)) {
      merged.mcpServers[name] = config;
    }

    // 项目级配置覆盖或新增
    for (const [name, projectServerConfig] of Object.entries(projectConfig.mcpServers)) {
      if (merged.mcpServers[name]) {
        // 深度合并
        merged.mcpServers[name] = this.mergeServerConfig(
          merged.mcpServers[name],
          projectServerConfig
        );
      } else {
        // 新增项目专属服务器
        merged.mcpServers[name] = projectServerConfig;
      }
    }

    getLogger().debug({ merged }, "Merged MCP config");
    return merged;
  }

  /**
   * 保存配置到指定级别
   * @param config 要保存的配置（部分配置，会与现有配置合并）
   * @param level 保存级别：system 或 project
   */
  async saveConfig(config: Partial<MCPConfig>, level: "system" | "project"): Promise<void> {
    const targetPath = level === "system" ? this.systemConfigPath : this.projectConfigPath;

    if (!targetPath) {
      throw new Error("Project config path not set");
    }

    // 读取现有配置
    const existing = await this.loadConfig(targetPath);

    // 合并配置
    const updated: MCPConfig = {
      mcpServers: {
        ...existing.mcpServers,
        ...config.mcpServers,
      },
    };

    // 确保目录存在
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    // 写入配置
    await fs.writeFile(targetPath, JSON.stringify(updated, null, 2), "utf-8");
    getLogger().info({ level, path: targetPath }, "MCP config saved");
  }

  /**
   * 从配置中移除指定服务器
   * @param name 服务器名称
   * @param level 配置级别：system 或 project
   */
  async removeServer(name: string, level: "system" | "project"): Promise<void> {
    const targetPath = level === "system" ? this.systemConfigPath : this.projectConfigPath;

    if (!targetPath) {
      throw new Error("Project config path not set");
    }

    // 读取现有配置
    const existing = await this.loadConfig(targetPath);

    // 删除服务器
    delete existing.mcpServers[name];

    // 写入配置
    await fs.writeFile(targetPath, JSON.stringify(existing, null, 2), "utf-8");
    getLogger().info({ level, name }, "MCP server removed from config");
  }

  /**
   * 深度合并两个服务器配置
   * 项目级配置会覆盖系统级配置的同名字段
   * 特殊处理：env 对象合并，autoApprove 数组合并
   */
  private mergeServerConfig(
    base: MCPServerConfig,
    override: MCPServerConfig
  ): MCPServerConfig {
    const merged: MCPServerConfig = { ...base };

    // 覆盖基础字段
    if (override.transport !== undefined) merged.transport = override.transport;
    if (override.command !== undefined) merged.command = override.command;
    if (override.args !== undefined) merged.args = override.args;
    if (override.url !== undefined) merged.url = override.url;
    if (override.disabled !== undefined) merged.disabled = override.disabled;

    // 合并 env 对象
    if (override.env) {
      merged.env = { ...base.env, ...override.env };
    }

    // 合并 autoApprove 数组（去重）
    if (override.autoApprove) {
      const baseApprove = base.autoApprove || [];
      const overrideApprove = override.autoApprove || [];
      merged.autoApprove = [...new Set([...baseApprove, ...overrideApprove])];
    }

    return merged;
  }

  /**
   * 从指定路径加载配置文件
   * 如果文件不存在，返回空配置
   */
  private async loadConfig(configPath: string): Promise<MCPConfig> {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(content);
      const validated = MCPConfigSchema.parse(parsed);
      getLogger().debug({ path: configPath }, "MCP config loaded");
      return validated;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        getLogger().debug({ path: configPath }, "MCP config file not found, using empty config");
        return { mcpServers: {} };
      }
      getLogger().error({ path: configPath, error: (err as Error).message }, "Failed to load MCP config");
      throw err;
    }
  }
}
