import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createChildLogger } from "../logger/index.js";
import type { SkillDefinition, SkillSource, DomainIndex, ISkillRegistry } from "./types.js";

const logger = createChildLogger("skill-registry");

/** 系统级 skill 根目录：~/.cehnzcode/skills/ */
function getSystemSkillsRoot(): string {
  return path.join(os.homedir(), ".cehnzcode", "skills");
}

/** 项目级 skill 根目录：<projectRoot>/.cehnzcode/skills/ */
function getProjectSkillsRoot(projectRoot: string): string {
  return path.join(projectRoot, ".cehnzcode", "skills");
}

/** 判断路径是否存在 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 SKILL.md 提取一行描述，支持两种格式：
 *
 * 1. YAML frontmatter（优先）：
 *    ---
 *    description: "描述内容"
 *    ---
 *
 * 2. 第一个 # 标题（回退）：
 *    # name — 描述内容
 */
async function extractDescription(skillMdPath: string): Promise<string> {
  try {
    const content = await fs.readFile(skillMdPath, "utf-8");

    // 尝试解析 YAML frontmatter
    if (content.startsWith("---")) {
      const closingIndex = content.indexOf("---", 3);
      if (closingIndex !== -1) {
        const frontmatter = content.slice(3, closingIndex);
        // 匹配 description: "值" 或 description: 值（支持单引号、双引号、无引号）
        const match = frontmatter.match(/^description:\s*["']?(.+?)["']?\s*$/m);
        if (match) return match[1].trim();
      }
    }

    // 回退：提取第一个 # 标题
    const firstHeading = content.split("\n").find((l) => l.trimStart().startsWith("#"));
    if (!firstHeading) return "";
    const title = firstHeading.replace(/^#+\s*/, "").trim();
    // 支持 " — "（中文破折号）和 " - "（连字符）作为名称与描述的分隔符
    const sepMatch = title.match(/\s[—\-]\s(.+)/);
    return sepMatch ? sepMatch[1].trim() : title;
  } catch {
    return "";
  }
}

/**
 * 扫描一个 skills 根目录，将找到的 skill 写入 skills Map
 * 支持两层结构：
 *   - 平铺：skillsRoot/skill-name/SKILL.md（无领域）
 *   - 领域：skillsRoot/domain/skill-name/SKILL.md
 *
 * 项目级（source=project）的 skill 会覆盖同名的系统级 skill。
 * 返回发现的领域索引列表（仅项目级有意义）。
 */
async function scanSkillsRoot(
  skillsRoot: string,
  source: SkillSource,
  skills: Map<string, SkillDefinition>
): Promise<DomainIndex[]> {
  const domains: DomainIndex[] = [];

  if (!(await pathExists(skillsRoot))) {
    logger.debug({ skillsRoot }, "Skills root does not exist, skipping");
    return domains;
  }

  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch (err) {
    logger.warn({ skillsRoot, error: (err as Error).message }, "Failed to read skills root");
    return domains;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const entryPath = path.join(skillsRoot, entry.name);
    const directSkillMd = path.join(entryPath, "SKILL.md");

    if (await pathExists(directSkillMd)) {
      // 平铺结构：entry 本身就是 skill 目录
      const description = await extractDescription(directSkillMd);
      const skill: SkillDefinition = {
        name: entry.name,
        description,
        skillMdPath: directSkillMd,
        dirPath: entryPath,
        source,
      };

      // 项目级覆盖系统级
      if (source === "project" || !skills.has(entry.name)) {
        skills.set(entry.name, skill);
        logger.debug({ name: entry.name, source }, "Skill registered");
      }
    } else {
      // 可能是领域目录，扫描其子目录
      const domainName = entry.name;
      let subEntries: Awaited<ReturnType<typeof fs.readdir>>;

      try {
        subEntries = await fs.readdir(entryPath, { withFileTypes: true });
      } catch {
        continue;
      }

      let hasDomainSkills = false;

      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory()) continue;

        const subPath = path.join(entryPath, subEntry.name);
        const subSkillMd = path.join(subPath, "SKILL.md");

        if (await pathExists(subSkillMd)) {
          const description = await extractDescription(subSkillMd);
          const skill: SkillDefinition = {
            name: subEntry.name,
            description,
            skillMdPath: subSkillMd,
            dirPath: subPath,
            source,
            domain: domainName,
          };

          if (source === "project" || !skills.has(subEntry.name)) {
            skills.set(subEntry.name, skill);
            logger.debug({ name: subEntry.name, domain: domainName, source }, "Skill registered");
          }

          hasDomainSkills = true;
        }
      }

      // 记录领域（无论 index.md 是否存在）
      if (hasDomainSkills) {
        domains.push({
          name: domainName,
          indexMdPath: path.join(entryPath, "index.md"),
        });
      }
    }
  }

  return domains;
}

/**
 * Skill 注册表
 * 启动时扫描系统级和项目级两个目录，在内存中维护 name → SkillDefinition 的 Map。
 * 文件系统本身就是数据源，不需要额外的配置文件。
 */
export class SkillRegistry implements ISkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  private projectDomains: DomainIndex[] = [];
  private scanned = false;

  async scan(projectRoot?: string): Promise<void> {
    this.skills.clear();
    this.projectDomains = [];

    const root = projectRoot ?? process.cwd();

    // 先扫系统级（优先级低），再扫项目级（优先级高，会覆盖同名 skill）
    await scanSkillsRoot(getSystemSkillsRoot(), "system", this.skills);
    this.projectDomains = await scanSkillsRoot(
      getProjectSkillsRoot(root),
      "project",
      this.skills
    );

    this.scanned = true;
    logger.info(
      { total: this.skills.size, domains: this.projectDomains.length },
      "Skill registry scanned"
    );
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  getAll(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  getBySource(source: SkillSource): SkillDefinition[] {
    return this.getAll().filter((s) => s.source === source);
  }

  /**
   * 生成系统级 skill 列表片段，注入到 system prompt。
   * 只列出系统级 skill 的名称和简介，让模型知道有哪些通用 skill 可以调用。
   * 项目级领域 skill 的说明已静态写在 SYSTEM_PROMPT 中。
   */
  buildSystemPromptSnippet(): string {
    if (!this.scanned) return "";

    const systemSkills = this.getBySource("system");
    if (systemSkills.length === 0) return "";

    const lines = ["## 通用 Skills\n", "以下 Skills 可通过 `use_skill` 工具直接调用：\n"];
    for (const skill of systemSkills) {
      const desc = skill.description ? `: ${skill.description}` : "";
      lines.push(`- **${skill.name}**${desc}`);
    }

    return lines.join("\n");
  }
}
