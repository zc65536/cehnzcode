/** 错误记录的作用域 */
export type KnowledgeScope = "system" | "project";

/** 工具调用结果类型 */
export type KnowledgeOutcome =
  | "recorded"    // 值得记录，已写入错题本
  | "skipped"     // 已在错题本中 或 不值得记录，跳过
  | "unsolvable"; // 未能解决，记录错误和尝试过的方法

/** 一条错题记录 */
export interface KnowledgeRecord {
  id: string;
  timestamp: number;
  scope: KnowledgeScope;
  error: string;       // 错误内容
  background: string;  // 发生时的背景
  solution: string;    // 解决方法（unsolvable 时填写尝试过的方法）
  outcome: KnowledgeOutcome;
}

/** record_knowledge 工具的入参 */
export interface RecordKnowledgeArgs {
  scope: KnowledgeScope;
  error: string;
  background: string;
  solution: string;
  outcome: KnowledgeOutcome;
}

/** KnowledgeManager 对外接口 */
export interface IKnowledgeManager {
  /** 写入一条记录（outcome 为 skipped 时不落盘，仅用于关闭 flag） */
  record(args: RecordKnowledgeArgs): Promise<KnowledgeRecord | null>;

  /** 读取全部记录（合并系统级和项目级） */
  getAll(): Promise<KnowledgeRecord[]>;

  /** 关键词搜索（用于大数据集场景） */
  search(query: string, limit?: number): Promise<KnowledgeRecord[]>;

  /** 是否启用 */
  isEnabled(): boolean;

  /** 运行时切换开关 */
  setEnabled(enabled: boolean): void;

  /** 重置待处理注入状态（供 /knowledge clear 命令使用） */
  resetPending(): void;
}

/** 存储文件的格式 */
export interface KnowledgeStore {
  version: string;
  errors: KnowledgeRecord[];
}
