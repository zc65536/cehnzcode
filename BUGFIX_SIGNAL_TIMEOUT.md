# Bug修复：工具执行 "The operation was aborted" 错误

## 问题描述

用户在使用过程中遇到删除文件失败的问题：

```bash
💻 del /F 西游记.txt
❌ Command failed: The operation was aborted
```

**关键发现**：
- 手动执行 `del /F 西游记.txt` 成功
- 通过工具执行相同命令失败
- 错误信息："The operation was aborted"

## 根本原因

### 问题1：共享的 AbortSignal

在 `src/orchestrator/index.ts` 中：

```typescript
this.executor = new ToolExecutor({
  cwd: process.cwd(),
  config,
  signal: AbortSignal.timeout(config.toolTimeout), // ❌ 问题所在
});
```

**问题**：
1. `AbortSignal.timeout(30000)` 在 Orchestrator 构造函数中创建
2. 信号从程序启动时就开始计时
3. 所有工具调用共享同一个 signal
4. 如果从启动到执行工具的时间超过 30 秒，所有后续工具调用都会收到 "aborted" 错误

### 问题2：中文文件名处理

虽然不是主要问题，但 bash 工具的描述不够清晰，没有明确告诉 AI 模型：
- 在 Windows bash 环境下应该使用 Unix 命令（`rm` 而不是 `del`）
- 应该使用正斜杠路径

## 解决方案

### 修复1：为每次工具执行创建独立的超时信号

**文件**：`src/tools/executor.ts`

```typescript
async run(call: ToolCall): Promise<ToolResult> {
  // ... 省略其他代码 ...
  
  try {
    // 为每次工具执行创建新的超时信号，避免共享信号导致的超时问题
    const toolCtx = {
      ...this.ctx,
      signal: AbortSignal.timeout(this.ctx.config.toolTimeout),
    };
    
    const output = await tool.execute(call.arguments, toolCtx);
    // ... 省略其他代码 ...
  }
}
```

**关键改进**：
- 每次调用 `run()` 时创建新的 `AbortSignal.timeout()`
- 每个工具执行都有独立的 30 秒超时
- 长时间运行的会话不会影响后续工具调用

### 修复2：更新 Orchestrator 中的默认 signal

**文件**：`src/orchestrator/index.ts`

```typescript
this.executor = new ToolExecutor({
  cwd: process.cwd(),
  config,
  signal: new AbortController().signal, // 使用永不中止的 signal 作为默认值
});
```

### 修复3：改进 bash 工具描述

**文件**：`src/tools/builtins/bash.ts`

```typescript
const bash: ToolDefinition = {
  name: "bash",
  description: `Execute a shell command. Current system: ${env.platform}, shell: ${env.shell}. On Windows with bash, use forward slashes (/) for paths and standard Unix commands.`,
  parameters: {
    type: "object",
    properties: {
      command: { 
        type: "string", 
        description: `Shell command to execute in ${env.shell} on ${env.platform}. For Windows bash: use 'rm' instead of 'del', use forward slashes for paths.` 
      },
      // ...
    },
  },
  // ...
};
```

## 测试验证

创建了以下测试文件：

1. **`src/tools/test-signal-timeout.ts`**：验证信号超时修复
   - 测试快速命令执行
   - 测试等待后的命令执行（验证信号独立性）
   - 测试超时命令
   - 测试超时后的命令执行

2. **`src/tools/builtins/test-chcp-issue.ts`**：验证 chcp 65001 对中文文件名的影响

3. **`src/tools/builtins/test-abort-issue.ts`**：验证 AbortSignal 的行为

4. **`src/tools/builtins/test-bash-chinese.ts`**：验证中文文件名支持

## 运行测试

```bash
# 测试信号超时修复
npx tsx src/tools/test-signal-timeout.ts

# 测试中文文件名支持
npx tsx src/tools/builtins/test-bash-chinese.ts

# 测试 chcp 问题
npx tsx src/tools/builtins/test-chcp-issue.ts

# 测试 abort 问题
npx tsx src/tools/builtins/test-abort-issue.ts
```

## 影响范围

- ✅ 修复了长时间运行会话中工具执行失败的问题
- ✅ 每个工具调用现在都有独立的 30 秒超时
- ✅ 改进了 Windows bash 环境下的命令提示
- ✅ 不影响现有功能，向后兼容

## 相关文件

- `src/orchestrator/index.ts` - 修改默认 signal
- `src/tools/executor.ts` - 为每次工具执行创建独立 signal
- `src/tools/builtins/bash.ts` - 改进工具描述和 shell 检测
- `src/tools/test-signal-timeout.ts` - 新增测试
- `src/tools/builtins/test-*.ts` - 新增多个测试文件

## 总结

这个 bug 是一个典型的**资源共享问题**：

1. **预期行为**：每个工具调用有独立的超时
2. **实际行为**：所有工具调用共享一个从程序启动就开始计时的超时信号
3. **修复方法**：在每次工具执行时创建新的超时信号

修复后，用户可以在长时间运行的会话中正常使用所有工具，不会再遇到 "The operation was aborted" 错误。
