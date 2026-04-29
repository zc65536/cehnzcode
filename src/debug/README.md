# Debug 模块

临时调试工具，项目完成后可以删除。

## API Logger

记录完整的 API 请求和响应，用于调试 token 计数等问题。

### 启用方法

在 `.env` 文件中添加：

```env
DEBUG_API_LOG=true
```

### 日志位置

日志保存在 `.debug/api-logs/` 目录，文件名格式：

```
2026-04-29_14-30-25-123.json
```

### 日志内容

每个日志文件包含：

- **request**: 完整的请求数据（model, messages, tools 等）
- **response**: 完整的响应数据（content, usage, finish_reason 等）
- **analysis**: 统计分析（消息数量、字符长度、token/字符比例等）

### 示例日志

```json
{
  "timestamp": "2026-04-29T14:30:25.123Z",
  "request": {
    "model": "qwen3.5-plus-2026-02-15",
    "messages": [
      { "role": "system", "content": "..." },
      { "role": "user", "content": "1" }
    ],
    "tools": [...],
    "maxTokens": 8192
  },
  "response": {
    "content": "1",
    "toolCalls": [],
    "usage": {
      "prompt": 996,
      "completion": 36,
      "total": 1032
    },
    "finishReason": "stop"
  },
  "analysis": {
    "messageCount": 2,
    "totalPromptLength": 1500,
    "responseLength": 1,
    "tokensPerChar": 36.00
  }
}
```

### 清理

项目完成后，删除以下内容：

1. `src/debug/` 目录
2. `.debug/` 目录
3. `src/model/index.ts` 中的 `apiLogger` 相关代码
4. `.env` 中的 `DEBUG_API_LOG` 配置
