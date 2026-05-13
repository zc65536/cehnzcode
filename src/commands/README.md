# Commands 模块

命令系统用于处理用户输入的斜杠命令（如 `/help`、`/clear` 等）。

## 目录结构

```
src/commands/
├── index.ts          # 命令加载器
├── registry.ts       # 命令注册表
├── types.ts          # 类型定义
└── builtins/         # 内置命令
    ├── clear.ts
    ├── exit.ts
    ├── help.ts
    └── mcp.ts
```

## 添加新命令

### 1. 创建命令文件

在 `src/commands/builtins/` 目录下创建新文件，例如 `mycommand.ts`：

```typescript
import type { CommandDefinition, CommandContext } from "../types.js";

export const myCommand: CommandDefinition = {
  name: "mycommand",
  description: "我的自定义命令",
  
  async execute(args: string, ctx: CommandContext): Promise<void> {
    // args: 命令参数字符串（如 "/mycommand foo bar" 中的 "foo bar"）
    // ctx: 命令执行上下文，包含：
    //   - ui: UI 适配器，用于显示消息
    //   - config: 应用配置
    //   - context: 对话上下文管理器
    //   - exit: 退出函数
    
    ctx.ui.showAssistantMessage(`执行命令，参数: ${args}`);
  },
};
```

### 2. 注册命令

在 `src/commands/index.ts` 的 `commandFiles` 数组中添加新文件：

```typescript
const commandFiles = [
  "./builtins/clear.js",
  "./builtins/exit.js",
  "./builtins/help.js",
  "./builtins/mcp.js",
  "./builtins/mycommand.js",  // 添加这一行
];
```

**注意**：文件路径使用 `.js` 扩展名（因为是编译后的文件）。

### 3. 重新构建

```bash
npm run build
```

### 4. 使用命令

```bash
npm start
> /mycommand test arguments
```

## 命令类型定义

```typescript
interface CommandDefinition {
  name: string;                    // 命令名称（不含斜杠）
  description: string;             // 命令描述（用于 /help）
  execute: (                       // 执行函数
    args: string,                  // 命令参数
    ctx: CommandContext            // 执行上下文
  ) => void | Promise<void>;
}

interface CommandContext {
  ui: UIAdapter;                   // UI 适配器
  config: AppConfig;               // 应用配置
  context: ConversationManager;    // 对话上下文
  exit: () => void;                // 退出函数
}
```

## 示例：带参数的命令

```typescript
export const echoCommand: CommandDefinition = {
  name: "echo",
  description: "回显输入的文本",
  
  execute(args: string, ctx: CommandContext): void {
    if (!args.trim()) {
      ctx.ui.showAssistantMessage("用法: /echo <message>");
      return;
    }
    ctx.ui.showAssistantMessage(`Echo: ${args}`);
  },
};
```

## 示例：异步命令

```typescript
export const statusCommand: CommandDefinition = {
  name: "status",
  description: "显示系统状态",
  
  async execute(_args: string, ctx: CommandContext): Promise<void> {
    ctx.ui.showAssistantMessage("正在检查状态...");
    
    // 执行异步操作
    const status = await checkSystemStatus();
    
    ctx.ui.showAssistantMessage(`状态: ${status}`);
  },
};
```

## 为什么使用显式文件列表？

虽然使用文件系统扫描（`fs.readdir`）更灵活，但会导致打包问题：

- ❌ **打包工具无法静态分析**：动态路径在运行时才确定
- ❌ **编译后文件缺失**：tsup 不会包含未被引用的文件
- ❌ **部署困难**：需要保持完整的目录结构

使用显式列表的优点：

- ✅ **打包友好**：tsup 可以正确追踪和打包所有依赖
- ✅ **类型安全**：编译时检查导入路径
- ✅ **性能更好**：无需运行时扫描文件系统
- ✅ **易于维护**：清晰列出所有命令

## 未来扩展：插件系统

如果需要支持用户自定义命令（不重新编译），可以考虑：

1. 在配置文件中指定外部命令目录
2. 运行时从该目录动态加载 `.js` 文件
3. 使用 `vm` 模块或 `eval` 执行（需注意安全性）

这部分功能可以在 `src/plugins/` 模块中实现。
