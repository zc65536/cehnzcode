# Knowledge 模块接口速查

## 单例

```typescript
import { knowledgeManager } from "../knowledge/index.js";
```

## IKnowledgeManager

| 方法 | 说明 |
|---|---|
| `record(args)` | 写入一条错题记录，`skipped` 时不落盘，返回 `null` |
| `getAll()` | 读取所有记录（合并系统级 + 项目级） |
| `search(query, limit?)` | 关键词搜索，默认最多返回 5 条 |
| `isEnabled()` | 返回当前开关状态 |
| `setEnabled(enabled)` | 运行时切换开关（不持久化） |
| `resetPending()` | 重置待处理注入状态 |

## 存储路径

- 系统级：`~/.cehnzcode/knowledge/errors.json`
- 项目级：`<cwd>/.cehnzcode/knowledge/errors.json`

## Hook 挂载点

| Hook | 作用 |
|---|---|
| `tool:after` | 检测工具失败，设置/清除 `pendingInjection` flag |
| `model:before` | 功能关闭时过滤知识库工具；flag=true 时将错题本内容追加到系统提示词末尾 |

## 工具

- `record_knowledge`：模型调用以关闭错误处理闭环（始终注册）
- `search_knowledge`：大数据集（>20条）时动态注入，供模型按需搜索

## 命令

- `/knowledge on|off`：运行时切换
- `/knowledge list`：查看所有记录
- `/knowledge clear`：重置 pending 注入状态

## 配置

- `KNOWLEDGE_ENABLED=false`：通过 `.env` 持久关闭
- `AppConfig.knowledgeEnabled`：默认 `true`
