// src/prompts/planner.ts
// 所有 planner 相关提示词

import type { Message } from "../types.js";

/**
 * Phase 2: 讨论阶段系统提示词
 * 注入项目级 CEHNZ.md 内容（可选）
 */
export function buildPlanDiscussionPrompt(projectInstructions?: string): string {
  return `你正在协助用户规划一个待执行的任务。这是一次多轮讨论，目标是在进入正式的任务分解之前，把任务的需求、边界、依赖、约束充分澄清。

## 你的角色

你是任务规划顾问，不是任务执行者。本阶段你只参与讨论，不生成最终的模块化计划——计划生成由后续独立环节完成。
${projectInstructions ? `\n## 项目规范（CEHNZ.md）\n\n${projectInstructions}\n` : ""}
## 讨论原则

1. **主动提问**，识别用户描述中的歧义、遗漏、矛盾
2. **暴露隐性依赖**（例如认证、数据库、外部服务、已有模块的接口）
3. **提示非功能性约束**（错误处理、并发、可观测性等），但不强加
4. **建议模块边界**，让用户确认，而不是替用户决定
5. **不轻易跳到代码层细节**，停留在"做什么、模块如何划分"的层面
6. **简洁**，避免长篇大论。一次回复聚焦 1-2 个关键问题

## 何时结束讨论

当你识别到用户表达了明确的"可以开始规划"意图（例如"就这样吧"、"开始生成计划"、"OK 可以了"、"动手吧"），按以下格式回复：

1. 先用自然语言简短总结讨论结论：
   - 任务目标
   - 已确认的关键边界和约束
   - 主要模块设想（粗粒度，1-5 个）

2. 在回复的**最后一行单独输出标记**：\`[READY_TO_PLAN]\`

**重要**：
- 如果用户的意图模糊（例如只回复"嗯"、"好的"、"明白了"），**不要输出标记**。改为反问确认，例如："那我们就基于以上讨论开始生成计划，可以吗？"
- 不要在讨论尚未充分时主动提议结束。等用户先表达意图。
- 标记必须单独一行，不要包裹在代码块或引号里。
`;
}

const CREATION_REQUIREMENTS = `
## 拆分原则

1. 分解为 1-10 个模块，每个模块职责单一、边界清晰
2. 用数组下标（0, 1, 2...）作为模块唯一标识
3. 只描述"要做什么"，不涉及具体实现
4. 依赖关系：
   - dependsOn：必须等待哪些模块完成才能开始（决定执行顺序）
   - relatedModules：执行时需要参考哪些模块的产出（仅供参考，不阻塞）
5. 模块间交互：
   - inputs：本模块依赖哪些其他模块的对外接口，含接口名和功能描述，source 填提供方下标
   - outputs：本模块完成后对外提供什么
6. 交互完整性：每个 input 必须能在对应 source 模块的 outputs 中找到
7. 宁多勿少：漏掉依赖比多写依赖代价更高
8. 禁止循环依赖
9. **组装模块**：如果各模块的产出需要整合才能形成最终交付物（如路由/中间件挂载到主应用、模块在入口文件显式初始化、多个产出统一对外暴露），则必须规划一个组装模块，dependsOn 所有需要整合的模块。纯工具函数、类型定义等调用方通过 import 直接使用、无需显式注册的场景，不需要组装模块。

## 输出格式

只输出 JSON，不要有任何其他内容。

\`\`\`json
{
  "description": "任务整体说明",
  "modules": [
    {
      "name": "模块简称",
      "description": "这个模块要完成什么",
      "dependsOn": [],
      "relatedModules": [],
      "inputs": [
        {
          "name": "需要什么",
          "description": "具体说明",
          "source": 0
        }
      ],
      "outputs": [
        {
          "name": "产出什么",
          "description": "具体说明"
        }
      ]
    }
  ],
  "metadata": {
    "estimatedDuration": 30,
    "complexity": "medium",
    "tags": []
  }
}
\`\`\``;

const codingSkill = `## 代码任务拆分指导

- 按功能边界拆分，不按文件拆分
- outputs/inputs 对应代码层面的接口：函数、中间件、类、配置等
- 数据模型定义通常应作为独立模块，被其他模块依赖
- 公共工具函数归入独立模块
- 如果任务涉及 API，按资源（而非 HTTP 方法）划分模块`;
/**
 * Phase 3: 直接模式计划创建提示词
 * 用户已有明确任务描述，跳过讨论直接规划
 */
export function buildPlanCreationPrompt(task: string, projectInstructions?: string): string {
  return `你是一个任务规划专家。将以下任务分解为可独立执行的模块。

## 任务

${task}

${codingSkill ? `## 领域指导\n\n${codingSkill}\n` : ""}
${projectInstructions ? `\n## 项目规范（CEHNZ.md）\n\n${projectInstructions}\n` : ""}${CREATION_REQUIREMENTS}`;
}

/**
 * Phase 3: 讨论模式计划创建提示词
 * 将讨论历史格式化后作为任务描述来源
 */
export function buildPlanCreationTalkPrompt(
  discussionHistory: Message[],
  projectInstructions?: string
): string {
  const historyText = discussionHistory
    .map(msg => `${msg.role === "user" ? "用户" : "助手"}: ${msg.content}`)
    .join("\n\n");

  return `你是一个任务规划专家。根据以下讨论内容，将任务分解为独立的功能模块。

## 讨论记录

${historyText}
${codingSkill ? `## 领域指导\n\n${codingSkill}\n` : ""}
${projectInstructions ? `\n## 项目规范（CEHNZ.md）\n\n${projectInstructions}\n` : ""}${CREATION_REQUIREMENTS}`;
}

/**
 * Phase 3: 计划供需匹配验证提示词
 * 让模型扮演架构审查员，检查接口依赖是否完整
 */
export function buildPlanValidationPrompt(planJson: string): string {
  return `你是一个架构审查员。审查以下任务计划，检查三个方面：

## 待审查的计划

\`\`\`json
${planJson}
\`\`\`

## 审查项

1. **循环依赖**：\`dependsOn\` 中是否存在循环依赖（A 依赖 B，B 依赖 A）
2. **接口供需匹配**：所有模块 \`inputContract\` 声明的接口，是否都能在某个模块的 \`outputContract\` 中找到对应提供方
3. **职责重叠**：是否有多个模块声明了相同或高度重叠的 \`outputContract\` 接口

## 输出格式

**只输出 JSON，不要有其他内容。**

如果存在问题：
\`\`\`json
{
  "valid": false,
  "issues": [
    {
      "type": "missing_provider",
      "description": "模块 module_003 需要接口 'verifyToken'，但没有模块提供此接口",
      "modules": [3]
    },
    {
      "type": "circular_dependency",
      "description": "module_001 依赖 module_002，module_002 依赖 module_001",
      "modules": [1, 2]
    },
    {
      "type": "overlap",
      "description": "module_002 和 module_004 都声明了 'authMiddleware' 接口",
      "modules": [2, 4]
    }
  ]
}
\`\`\`

如果没有问题：
\`\`\`json
{
  "valid": true,
  "issues": []
}
\`\`\``;
}

/** Phase 4: 构建模块执行系统提示词 */
export function buildModuleExecutionPrompt(
  plan: import("../planner/types.js").TaskPlan,
  module: import("../planner/types.js").Module,
  relatedNotes: Map<string, import("../planner/types.js").ModuleNote>
): string {
  const moduleList = plan.modules
    .map((m, i) => `${i + 1}. ${m.description} [${m.status}]`)
    .join("\n");

  const outputContracts = module.outputContract
    .map(c => `- ${c.name}：${c.description}`)
    .join("\n");

  const inputContracts = module.inputContract
    .map(c => `- ${c.name}（来自 ${c.sourceModule ?? "未知"}）：${c.description}`)
    .join("\n");

  const relatedNotesText = Array.from(relatedNotes.entries())
    .map(([moduleId, note]) => {
      const files = note.files.map(f => `  - ${f.path}: ${f.description}`).join("\n");
      const exports = note.exports.map(e => `  - ${e.name}: ${e.description}`).join("\n");
      return `### ${moduleId}\n\n文件：\n${files}\n\n导出：\n${exports}`;
    })
    .join("\n\n");

  return `你正在执行一个任务计划中的一个模块。

## 总体目标

${plan.task}

## 完整模块列表

${moduleList}

## 当前模块（第 ${module.index + 1} 个，共 ${plan.modules.length} 个）

${module.description}

## 你必须实现的对外接口

${outputContracts || "（无）"}

**重要**：以上接口必须全部实现并导出，不可遗漏。

## 你可以使用的外部接口

${inputContracts || "（无）"}

${relatedNotesText ? `## 来自相关模块的信息\n\n${relatedNotesText}` : ""}

## 执行要求

1. **只实现当前模块**，不要修改其他模块负责的文件
2. **必须实现所有 outputContract 声明的接口**，并正确导出
3. **代码风格**：遵循项目规范，易读优先，使用 async/await
4. **测试**：不需要在本阶段编写测试（测试由验证阶段自动生成）
5. **完成标志**：实现完成后，停止工具调用，系统会自动收集你的实现并生成模块笔记

开始实现吧！`;
}

/** Phase 4: 构建笔记生成提示词，追加到对话历史末尾，要求模型输出 ModuleNote JSON */
export function buildNoteGenerationPrompt(
  _module: import("../planner/types.js").Module
): string {
  return `实现已完成。请根据你的实际实现，输出本模块的笔记。

## 笔记格式

**只输出 JSON，不要有其他内容。**

\`\`\`json
{
  "files": [
    { "path": "src/auth/jwt.ts", "description": "JWT 工具函数" }
  ],
  "exports": [
    { "name": "generateToken", "description": "生成 JWT token" },
    { "name": "verifyToken", "description": "验证 JWT token 并返回 payload" }
  ],
  "envVars": ["JWT_SECRET"],
  "extra": {
    "dependencies": "jsonwebtoken@9.0.0"
  }
}
\`\`\`

## 字段说明

- \`files\`：本模块创建或修改的文件列表（必填）
- \`exports\`：本模块对外暴露的接口列表（必填，应覆盖 outputContract）
- \`envVars\`：本模块依赖的环境变量（可选）
- \`extra\`：需要其他模块知道的额外信息（可选）

请输出笔记：`;
}

/** Phase 5: 笔记验证提示词——对比 outputContract 与模块笔记是否一致 */
export function buildValidateNotePrompt(
  module: import("../planner/types.js").Module
): string {
  return `对比以下两份信息，判断模块笔记是否完整覆盖了声明的对外接口。

## 计划阶段声明的对外接口（outputContract）

\`\`\`json
${JSON.stringify(module.outputContract, null, 2)}
\`\`\`

## 模块执行后写入的笔记（exports）

\`\`\`json
${JSON.stringify(module.note?.exports ?? [], null, 2)}
\`\`\`

## 判断标准

outputContract 中每一个接口，都必须在笔记的 exports 中找到对应条目：
- 名称必须完全匹配
- 功能描述语义一致（允许措辞不同，但含义相同）

## 输出格式

**只输出 JSON，不要有其他内容。**

如果全部覆盖：

\`\`\`json
{ "valid": true, "missing": [], "mismatch": [] }
\`\`\`

如果有问题：

\`\`\`json
{
  "valid": false,
  "missing": ["verifyToken", "UserId"],
  "mismatch": [
    { "name": "generateToken", "issue": "描述不符：声明返回 string，笔记中描述为返回 token 对象" }
  ]
}
\`\`\``;
}

/** Phase 5: 测试生成、运行与修复提示词 */
export function buildTestGenerationPrompt(
  module: import("../planner/types.js").Module,
  codeFiles: Array<{ path: string; content: string }>
): string {
  const outputContracts = module.outputContract
    .map(c => `- ${c.name}：${c.description}`)
    .join("\n");

  const filesContent = codeFiles
    .map(f => `### ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  return `为以下模块的对外接口编写测试，运行测试，如果失败则修复，直到测试全部通过。

## 模块对外接口（outputContract）

${outputContracts || "（无）"}

## 模块笔记

\`\`\`json
${JSON.stringify(module.note, null, 2)}
\`\`\`

## 相关代码文件

${filesContent || "（无文件）"}

## 执行步骤

1. **编写测试**：根据代码文件的语言选择对应框架（pytest / go test / vitest 等），用 write_file 写入测试文件
2. **运行测试**：用 bash 执行测试命令
3. **修复失败**：如果测试失败，分析原因，用 edit_file 修改代码或测试文件，再次运行
4. **循环直到通过**：重复步骤3，直到所有测试通过
5. **清理测试文件**：测试通过后，用 bash 删除所有测试文件（测试文件是临时产物，不应留在项目中）

## 输出格式

全部完成后，**只输出以下格式，不要有其他内容**：

如果测试通过：
\`\`\`
PASS
<测试文件路径1>
<测试文件路径2>
\`\`\`

如果最终仍然失败：
\`\`\`
FAIL: <失败原因简述>
<测试文件路径1>
\`\`\``;
}
