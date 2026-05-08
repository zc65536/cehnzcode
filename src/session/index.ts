import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Turn, AppConfig } from "../types.js";
import type { CompressionMetadata, RAGFile } from "../context/types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("session");

interface SessionMetadata {
  sessionId: string;
  createdAt: number;
  lastUpdatedAt: number;
  compressionCount: number;
  lastCompressedAt: number;
}

export class SessionManager {
  private sessionDir: string;
  private currentSessionId: string | null = null;

  constructor(config: AppConfig) {
    this.sessionDir = config.sessionDir;
  }

  /**
   * 初始化会话
   * 创建新的会话 ID 和目录
   */
  async init(): Promise<string> {
    const sessionId = this.generateSessionId();
    this.currentSessionId = sessionId;

    const sessionPath = path.join(this.sessionDir, sessionId);
    await fs.mkdir(sessionPath, { recursive: true });

    // 创建元数据文件
    const metadata: SessionMetadata = {
      sessionId,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      compressionCount: 0,
      lastCompressedAt: 0,
    };
    await this.saveMetadata(metadata);

    // 初始化空的 RAG 文件
    await this.initRAG(sessionId);

    logger.info({ sessionId }, "Session initialized");
    return sessionId;
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string {
    if (!this.currentSessionId) {
      throw new Error("Session not initialized. Call init() first.");
    }
    return this.currentSessionId;
  }

  /**
   * 保存对话轮次
   */
  async saveTurns(turns: Turn[]): Promise<void> {
    const sessionId = this.getSessionId();
    const turnsPath = path.join(this.sessionDir, sessionId, "turns.json");
    
    await fs.writeFile(
      turnsPath,
      JSON.stringify({ turns, savedAt: Date.now() }, null, 2),
      "utf-8"
    );

    // 更新元数据
    const metadata = await this.loadMetadata();
    metadata.lastUpdatedAt = Date.now();
    await this.saveMetadata(metadata);

    logger.debug({ sessionId, turnsCount: turns.length }, "Turns saved");
  }

  /**
   * 加载对话轮次
   */
  async loadTurns(sessionId: string): Promise<Turn[] | null> {
    const turnsPath = path.join(this.sessionDir, sessionId, "turns.json");
    
    try {
      const data = await fs.readFile(turnsPath, "utf-8");
      const parsed = JSON.parse(data);
      logger.debug({ sessionId, turnsCount: parsed.turns.length }, "Turns loaded");
      return parsed.turns;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /**
   * 获取压缩元信息
   */
  async getCompressionMetadata(): Promise<CompressionMetadata> {
    const metadata = await this.loadMetadata();
    return {
      count: metadata.compressionCount,
      lastCompressedAt: metadata.lastCompressedAt,
      lastRatio: 0, // TODO: 从历史记录中计算
      totalRemoved: 0, // TODO: 从历史记录中计算
    };
  }

  /**
   * 更新压缩元信息
   */
  async updateCompressionMetadata(update: Partial<CompressionMetadata>): Promise<void> {
    const metadata = await this.loadMetadata();
    
    if (update.count !== undefined) {
      metadata.compressionCount = update.count;
    }
    if (update.lastCompressedAt !== undefined) {
      metadata.lastCompressedAt = update.lastCompressedAt;
    }
    
    await this.saveMetadata(metadata);
    logger.debug({ update }, "Compression metadata updated");
  }

  /**
   * 获取 RAG 文件路径
   */
  getRAGPath(sessionId?: string): string {
    const sid = sessionId ?? this.getSessionId();
    return path.join(this.sessionDir, sid, "rag.json");
  }

  /**
   * 初始化 RAG 文件
   */
  private async initRAG(sessionId: string): Promise<void> {
    const ragPath = this.getRAGPath(sessionId);
    
    const ragFile: RAGFile = {
      entries: {},
      metadata: {
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        sessionId,
      },
    };

    await fs.writeFile(ragPath, JSON.stringify(ragFile, null, 2), "utf-8");
    logger.debug({ sessionId }, "RAG file initialized");
  }

  /**
   * 列出所有会话
   */
  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.sessionDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * 删除会话
   */
  async delete(sessionId: string): Promise<void> {
    const sessionPath = path.join(this.sessionDir, sessionId);
    await fs.rm(sessionPath, { recursive: true, force: true });
    logger.info({ sessionId }, "Session deleted");
  }

  /**
   * 加载元数据
   */
  private async loadMetadata(): Promise<SessionMetadata> {
    const sessionId = this.getSessionId();
    const metadataPath = path.join(this.sessionDir, sessionId, "metadata.json");
    
    try {
      const data = await fs.readFile(metadataPath, "utf-8");
      return JSON.parse(data);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        // 如果元数据文件不存在，返回默认值
        return {
          sessionId,
          createdAt: Date.now(),
          lastUpdatedAt: Date.now(),
          compressionCount: 0,
          lastCompressedAt: 0,
        };
      }
      throw err;
    }
  }

  /**
   * 保存元数据
   */
  private async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const metadataPath = path.join(this.sessionDir, metadata.sessionId, "metadata.json");
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    const date = new Date();
    const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
    const timeStr = date.toTimeString().split(" ")[0].replace(/:/g, "-"); // HH-MM-SS
    const random = Math.random().toString(36).substring(2, 8);
    return `${dateStr}_${timeStr}_${random}`;
  }

  // 保留旧的 API 以兼容现有代码
  async save(sessionId: string, turns: Turn[]): Promise<void> {
    this.currentSessionId = sessionId;
    await this.saveTurns(turns);
  }

  async load(sessionId: string): Promise<Turn[] | null> {
    return this.loadTurns(sessionId);
  }
}
