// src/planner/note-manager.ts

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Module, ModuleNote } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:note-manager");

/** 管理模块笔记的读写，同时维护 JSON（程序用）和 Markdown（人工阅读）两份 */
export class NoteManager {
  private notesDir: string;

  constructor(notesDir: string) {
    this.notesDir = notesDir;
  }

  /** 保存模块笔记：JSON 供程序使用，Markdown 供人工阅读 */
  async saveNote(module: Module, note: ModuleNote): Promise<void> {
    logger.info({ moduleId: module.id }, "Saving note");

    await fs.mkdir(this.notesDir, { recursive: true });

    const jsonPath = path.join(this.notesDir, `${module.id}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(note, null, 2), "utf-8");

    const mdPath = path.join(this.notesDir, `${module.id}.md`);
    await fs.writeFile(mdPath, this.noteToMarkdown(module, note), "utf-8");

    logger.info({ moduleId: module.id, jsonPath, mdPath }, "Note saved");
  }

  /** 读取模块笔记 JSON，文件不存在时返回 null */
  async loadNote(moduleId: string): Promise<ModuleNote | null> {
    logger.info({ moduleId }, "Loading note");

    const jsonPath = path.join(this.notesDir, `${moduleId}.json`);

    try {
      const data = await fs.readFile(jsonPath, "utf-8");
      return JSON.parse(data) as ModuleNote;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /** 批量读取多个模块的笔记，不存在的模块静默跳过 */
  async loadNotes(moduleIds: string[]): Promise<Map<string, ModuleNote>> {
    logger.info({ count: moduleIds.length }, "Loading multiple notes");

    const notes = new Map<string, ModuleNote>();

    for (const moduleId of moduleIds) {
      const note = await this.loadNote(moduleId);
      if (note) {
        notes.set(moduleId, note);
      }
    }

    return notes;
  }

  private noteToMarkdown(module: Module, note: ModuleNote): string {
    let md = `# ${module.id}\n\n`;
    md += `## 描述\n\n${module.description}\n\n`;

    md += `## 文件\n\n`;
    for (const file of note.files) {
      md += `- \`${file.path}\`: ${file.description}\n`;
    }

    md += `\n## 导出接口\n\n`;
    for (const exp of note.exports) {
      md += `- \`${exp.name}\`: ${exp.description}\n`;
    }

    if (note.envVars && note.envVars.length > 0) {
      md += `\n## 环境变量\n\n`;
      for (const envVar of note.envVars) {
        md += `- \`${envVar}\`\n`;
      }
    }

    if (note.extra && Object.keys(note.extra).length > 0) {
      md += `\n## 其他信息\n\n`;
      for (const [key, value] of Object.entries(note.extra)) {
        md += `- **${key}**: ${value}\n`;
      }
    }

    return md;
  }
}
