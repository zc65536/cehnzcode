import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Turn, AppConfig } from "../types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("session");

export class SessionManager {
  private sessionDir: string;

  constructor(config: AppConfig) {
    this.sessionDir = config.sessionDir;
  }

  async save(sessionId: string, turns: Turn[]): Promise<void> {
    await fs.mkdir(this.sessionDir, { recursive: true });
    const filePath = path.join(this.sessionDir, `${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify({ turns, savedAt: Date.now() }, null, 2));
    logger.debug({ sessionId }, "Session saved");
  }

  async load(sessionId: string): Promise<Turn[] | null> {
    const filePath = path.join(this.sessionDir, `${sessionId}.json`);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      logger.debug({ sessionId }, "Session loaded");
      return parsed.turns;
    } catch {
      return null;
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.sessionDir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
    } catch {
      return [];
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = path.join(this.sessionDir, `${sessionId}.json`);
    await fs.unlink(filePath);
  }
}
