根据方案梳理，一共需要以下几个提示词：

---

**1. plan-creation — 生成计划**

输入：用户任务描述、项目上下文
输出：完整计划 JSON（模块列表、dependsOn、relatedModules、inputContract、outputContract、元数据）

```
你是一个任务规划专家。给定一个任务，将其分解为独立的功能模块。

## 任务
${task}

## 项目上下文
${context}

## 要求
1. 将任务分解为 3-10 个模块，每个模块职责单一、边界清晰
2. 每个模块只描述"要做什么"，不展开内部实现细节
3. dependsOn：必须等待完成才能开始的模块（调度依据，影响执行顺序）
4. relatedModules：执行时需要参考笔记的模块（信息来源，不影响调度）
5. inputContract：本模块依赖哪些其他模块的对外接口，含接口名和功能描述
6. outputContract：本模块对外暴露哪些接口，含接口名和功能描述
7. 接口依赖关系宁多勿少，漏掉依赖比多写依赖代价更高

## 输出格式（只输出 JSON，不要有其他内容）
{
  "description": "任务整体说明",
  "modules": [
    {
      "description": "模块描述",
      "dependsOn": [0, 1],
      "relatedModules": [0, 1, 2],
      "inputContract": [
        { "name": "verifyToken", "description": "验证 JWT 并返回 UserId", "sourceModule": 1 }
      ],
      "outputContract": [
        { "name": "authMiddleware", "description": "Express 中间件，验证请求头中的 token" }
      ]
    }
  ],
  "metadata": {
    "estimatedDuration": 30,
    "complexity": "medium",
    "tags": ["refactor", "auth"]
  }
}
```

---

**2. plan-validation — 供需匹配验证**

输入：完整计划 JSON
输出：验证结果 JSON（通过 or 问题列表）

```
你是一个架构审查员。审查以下任务计划，检查三个方面：

## 待审查的计划
${planJson}

## 审查项
1. 循环依赖：dependsOn 中是否存在循环依赖（A 依赖 B，B 依赖 A）
2. 接口供需匹配：所有模块 inputContract 声明的接口，是否都能在某个模块的 outputContract 中找到对应提供方
3. 职责重叠：是否有多个模块声明了相同或高度重叠的 outputContract 接口

## 输出格式（只输出 JSON，不要有其他内容）
{
  "valid": true,
  "issues": [
    {
      "type": "missing_provider | circular_dependency | overlap",
      "description": "问题描述",
      "modules": [0, 2]
    }
  ]
}
```

---

**3. module-execution — 模块实现**

输入：计划信息、当前模块、inputContract、outputContract、相关模块笔记
输出：实现代码（通过工具调用写文件）

```
你正在执行一个任务计划中的一个模块。

## 总体目标
${plan.task}

## 完整模块列表
${plan.modules.map((m, i) => `${i + 1}. ${m.description} [${m.status}]`).join('\n')}

## 当前模块（第 ${module.index + 1} 个，共 ${plan.modules.length} 个）
${module.description}

## 你必须实现并导出的对外接口
${module.outputContract.map(c => `- ${c.name}：${c.description}`).join('\n')}
以上接口必须全部实现并导出，一个都不能少。

## 你可以使用的外部接口
${module.inputContract.map(c => `- ${c.name}（来自模块：${c.sourceModule}）：${c.description}`).join('\n')}

## 来自相关模块的笔记
${relatedNotesContext}

## 执行要求
- 实现生产级别的代码，不写占位符或 TODO
- 只创建和修改当前模块负责的文件，不修改其他模块的文件
- 如果相关模块笔记中的信息不足，根据笔记中的文件列表读取对应文件
```

---

**4. note-generation — 生成模块笔记**

输入：完整对话历史（模块实现过程）
输出：笔记 JSON

```
模块实现已完成。根据你刚才的实现，输出本模块的笔记。

只输出 JSON，不要有其他内容：

{
  "files": [
    { "path": "src/auth/jwt.ts", "description": "JWT 生成与验证核心逻辑" }
  ],
  "exports": [
    { "name": "verifyToken", "description": "验证 JWT token，返回 UserId" }
  ],
  "envVars": ["JWT_SECRET"],
  "extra": {}
}

要求：
- files 列出所有实际创建或修改的文件
- exports 按照你实际实现的接口填写，必须覆盖所有要求实现的对外接口
- 如果某个要求实现的接口没有出现在 exports 中，说明实现有遗漏，请先补充实现再输出笔记
```

---

**5. test-generation — 生成模块测试**

输入：outputContract、模块笔记、相关代码文件内容
输出：测试文件（通过工具调用写到 `.cehnzcode/notes/<module-id>.test.ts`）

```
为以下模块的对外接口生成单元测试。

## 模块对外接口（outputContract）
${module.outputContract.map(c => `- ${c.name}：${c.description}`).join('\n')}

## 模块笔记
${JSON.stringify(module.note, null, 2)}

## 相关代码文件
${codeFilesContent}

## 要求
- 针对每个对外接口至少写一个正常用例和一个边界/异常用例
- 只测试对外接口的行为，不测试内部实现细节
- 测试文件写入 .cehnzcode/notes/${module.id}.test.ts
```

---

**6. validate-note — 验证笔记与声明是否匹配**

输入：outputContract、模块笔记 JSON
输出：验证结果 JSON

```
对比以下两份信息，判断模块笔记是否完整覆盖了声明的对外接口。

## 计划阶段声明的对外接口（outputContract）
${JSON.stringify(module.outputContract, null, 2)}

## 模块执行后写入的笔记（exports）
${JSON.stringify(module.note.exports, null, 2)}

## 判断标准
outputContract 中每一个接口，都必须在笔记的 exports 中找到对应条目（名称匹配，功能描述语义一致）。

## 输出格式（只输出 JSON，不要有其他内容）
{
  "valid": true,
  "missing": ["verifyToken", "UserId"],
  "mismatch": [
    { "name": "generateToken", "issue": "描述不符：声明返回 string，笔记中描述为返回 token 对象" }
  ]
}
```

---

总共 6 个提示词，按阶段分布：

- createPlan：1、2
- executeModule：3、4
- validateNote：5、6