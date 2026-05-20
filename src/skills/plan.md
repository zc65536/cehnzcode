# Skills 系统 — 方案文档

## 目标

实现一个基于文件的 skill 系统，让模型能够发现并使用预定义的技能工作流。

Skill 是一个目录，包含 `SKILL.md`（使用说明）和可选的代码文件（脚本等）。模型读取 `SKILL.md` 后，按其中的指令通过 `bash` 等已有工具驱动 skill 代码执行。

---

## 存储位置

```
~/.cehnzcode/skills/         ← 系统级（通用 skill）
  pdf/
    SKILL.md
  docx/
    SKILL.md

<project>/.cehnzcode/skills/ ← 项目级（领域 skill）
  code/
    index.md                 ← 该领域下所有 skill 的名称和简介
    refactor/
      SKILL.md
      scripts/
        run.py
    review/
      SKILL.md
  docs/
    index.md
    generate/
      SKILL.md
```

**系统级 skill = 通用 skill**：每次对话都注入到 system prompt，模型随时可用。

**项目级 skill = 领域 skill**：按领域组织，默认不注入 system prompt，由模型在需要时主动发现。

---

## 发现机制

### System Prompt 中的内容

启动时向 system prompt 注入两部分：

**1. 通用 skill 列表**（系统级，始终可见）：
```
## 可用 Skills

以下 skills 随时可以通过 use_skill 工具调用：
- pdf: 处理 PDF 文件（读取、合并、拆分、提取等）
- docx: 创建和编辑 Word 文档
```

**2. 领域索引路径**（项目级，告知模型去哪里发现）：
```
## Skill 领域

项目中有以下 skill 领域，每个领域的 index.md 中列出了该领域的可用 skills：
- code: <project>/.cehnzcode/skills/code/index.md
- docs: <project>/.cehnzcode/skills/docs/index.md
```

### 模型的发现流程

```
遇到领域相关任务
  → 用 read_file 读取对应领域的 index.md
  → 找到合适的 skill 名称
  → 调用 use_skill(name) 加载 SKILL.md
  → 按 SKILL.md 指令，通过 bash 等工具执行
```

---

## Skill 查找规则

查找顺序（项目级优先覆盖系统级）：

1. `<project>/.cehnzcode/skills/**/name/SKILL.md`
2. `~/.cehnzcode/skills/**/name/SKILL.md`

启动时扫描两个根目录，遍历所有子目录，找到包含 `SKILL.md` 的目录，以目录名作为 skill name，构建内存中的 `name → SkillDefinition` Map。

文件系统即注册表，无需维护额外的配置文件。

---

## 接口设计

### 核心类型

```typescript
// src/skills/types.ts

/** Skill 来源 */
type SkillSource = "system" | "project";

/** Skill 定义（运行时内存中的表示） */
interface SkillDefinition {
  name: string;          // 唯一标识符，等于目录名
  description: string;   // 一行简介（从 SKILL.md 第一行 # 标题或首段提取）
  skillMdPath: string;   // SKILL.md 的绝对路径
  dirPath: string;       // skill 目录的绝对路径
  source: SkillSource;   // 来源
  domain?: string;       // 所属领域（项目级 skill 才有）
}

/** SkillRegistry 对外接口 */
interface ISkillRegistry {
  /** 扫描两个根目录，构建内存 Map */
  scan(): Promise<void>;

  /** 按 name 查找，找不到返回 undefined */
  get(name: string): SkillDefinition | undefined;

  /** 获取所有已注册的 skill */
  getAll(): SkillDefinition[];

  /** 按来源筛选 */
  getBySource(source: SkillSource): SkillDefinition[];

  /** 生成注入 system prompt 的文本片段 */
  buildSystemPromptSnippet(): string;
}
```

### use_skill Tool

```typescript
// src/tools/builtins/use_skill.ts

// 参数：只有 name
{
  name: "use_skill",
  description: `加载并激活指定 skill 的使用说明。
调用后模型将读取该 skill 的 SKILL.md，并按其中的指令完成任务。
如果不知道有哪些 skill，可先查看领域 index.md。`,
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "skill 的名称（目录名），例如 'pdf'、'refactor'"
      }
    },
    required: ["name"]
  }
}
// execute：从 skillRegistry 查找 name，读取 SKILL.md 内容，作为 tool result 返回给模型
```

### /skill 斜杠命令

```typescript
// src/commands/builtins/skill.ts

// 用途：用户直接指定 skill，跳过领域发现流程
// 用法：/skill <name>
// 行为：等同于 use_skill(name)，直接将 SKILL.md 内容注入当前对话上下文
```

---

## 目录结构

```
src/skills/
  plan.md          ← 本文档
  types.ts         ← SkillDefinition、ISkillRegistry 等类型（已有，需更新）
  registry.ts      ← SkillRegistry 实现（扫描 + 内存 Map）
  index.ts         ← 导出单例 skillRegistry

src/tools/builtins/
  use_skill.ts     ← use_skill tool 实现

src/commands/builtins/
  skill.ts         ← /skill <name> 命令实现

src/prompts/
  index.ts         ← buildSystemMessage 中集成 skillRegistry.buildSystemPromptSnippet()
```

---

## 实现顺序

1. **更新 `types.ts`**：将现有 `SkillDefinition`（含 execute 函数）替换为文件型定义
2. **实现 `registry.ts`**：扫描逻辑 + `get` / `getAll` / `buildSystemPromptSnippet`
3. **实现 `use_skill` tool**：查 registry → 读文件 → 返回内容
4. **实现 `/skill` 命令**：查 registry → 读文件 → addTurn 注入上下文
5. **集成到 orchestrator**：启动时调用 `skillRegistry.scan()`，system prompt 中追加 snippet

---

## index.md 格式约定

领域索引文件，供模型读取后决定使用哪个 skill：

```markdown
# code — 代码相关 Skills

| Skill | 说明 |
|-------|------|
| refactor | 重构代码，提升可读性和结构 |
| review | Code review，检查潜在问题 |
| test-gen | 根据源码自动生成单元测试 |
```

---

## SKILL.md 格式约定

每个 skill 目录下的使用手册，第一行为 `# skill 名称 — 一行描述`（registry 扫描时用于提取 description）：

```markdown
# refactor — 代码重构

## 使用场景
...

## 执行步骤
1. 读取目标文件
2. 运行 `python scripts/analyze.py <file>`
3. ...
```

---

## 模块接口速查

### `src/skills/index.ts`

```typescript
import { skillRegistry } from "./skills/index.js";

// 启动时扫描（index.ts 调用）
await skillRegistry.scan(process.cwd());

// 按 name 查找
const skill = skillRegistry.get("refactor");  // SkillDefinition | undefined

// 列出所有
skillRegistry.getAll();                        // SkillDefinition[]

// 按来源筛选
skillRegistry.getBySource("system");           // SkillDefinition[]

// 生成 system prompt 片段（orchestrator 调用）
const snippet = skillRegistry.buildSystemPromptSnippet();  // string
```

### `src/tools/builtins/use_skill.ts`

```typescript
// 注册为内置 tool（index.ts 调用）
toolRegistry.registerAll([..., useSkillTool]);

// 模型调用方式
use_skill({ name: "refactor" })
// → 返回 SKILL.md 内容字符串
```

### `src/commands/builtins/skill.ts`

```typescript
// 用户输入
/skill refactor        // 加载指定 skill，注入对话上下文
/skill list            // 列出所有已注册的 skill
/skill                 // 同 list
```
