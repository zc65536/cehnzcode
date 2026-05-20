/** Skill 的来源：系统级（通用）或项目级（领域） */
export type SkillSource = "system" | "project";

/**
 * Skill 定义 — 运行时内存中的表示
 * 对应文件系统上一个包含 SKILL.md 的目录
 */
export interface SkillDefinition {
  /** 唯一标识符，等于 skill 目录名 */
  name: string;
  /** 一行简介，从 SKILL.md 第一个 # 标题提取 */
  description: string;
  /** SKILL.md 的绝对路径 */
  skillMdPath: string;
  /** skill 目录的绝对路径 */
  dirPath: string;
  /** 来源 */
  source: SkillSource;
  /** 所属领域（项目级 skill 才有，等于父目录名） */
  domain?: string;
}

/**
 * 领域索引信息
 * 对应项目级 skills 目录下的一个领域子目录
 */
export interface DomainIndex {
  /** 领域名称（子目录名） */
  name: string;
  /** index.md 的绝对路径（可能不存在） */
  indexMdPath: string;
}

/** SkillRegistry 对外接口 */
export interface ISkillRegistry {
  /**
   * 扫描系统级和项目级 skill 目录，构建内存 Map
   * @param projectRoot 项目根目录，用于定位 .cehnzcode/skills/
   */
  scan(projectRoot?: string): Promise<void>;

  /** 按 name 查找 skill，项目级优先；找不到返回 undefined */
  get(name: string): SkillDefinition | undefined;

  /** 获取所有已注册的 skill */
  getAll(): SkillDefinition[];

  /** 按来源筛选 skill */
  getBySource(source: SkillSource): SkillDefinition[];

  /** 生成注入 system prompt 的文本片段 */
  buildSystemPromptSnippet(): string;
}
