
1. 既然 plan.md 里有 hooks/，你可以增加一个 command:before 事件。
用途：在执行 /clear 前，通过 Hook 自动保存当前会话（Session）到本地文件，防止用户误删。
实际上就是历史记录。

2. 增强流式输出（Streaming）支持，Orchestrator 层确保只有在获取到完整的 usage 后才调用 track √
对于计数token的，流式全部输出完之后再进行token计数，避免usage没有输出出来
详见：STREAMING_TOKENS_IMPLEMENTATION.md

3. 让工具真正聪明起来，会自动找文件，自动的去看需要看的文件。√

4. mcp 对应的tools兼容 √

5. 对给出的一个任务要自主的创建任务步骤。

6. 维护一个不局限于项目的错题本，让code越用越好用，也可以有一个和项目绑定的错题本

7. 上下文窗口可视化（用户体验）（这是压缩的时候提出的意见，做TUI的时候弄一下）
在 UI 中显示上下文使用情况：

Context: [████████░░] 80% (8000/10000 tokens)
├─ System Prompt: 1000 tokens
├─ Compressed History: 3000 tokens
└─ Recent 3 turns: 4000 tokens