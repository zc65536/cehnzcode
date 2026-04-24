
1. 既然 plan.md 里有 hooks/，你可以增加一个 command:before 事件。
用途：在执行 /clear 前，通过 Hook 自动保存当前会话（Session）到本地文件，防止用户误删。
实际上就是历史记录。

2. 增强流式输出（Streaming）支持，Orchestrator 层确保只有在获取到完整的 usage 后才调用 track
对于计数token的，流式全部输出完之后再进行token计数，避免usage没有输出出来

3. ToolRegistry 的不足：缺乏防抖与深度校验
缺乏 Schema 校验：
目前 register 只是把对象存进去。如果 tool.parameters 格式不符合 JSON Schema 规范，代码不会报错，但在调用 AI 接口时会导致模型理解错误。

建议：在 register 时增加对 JSON Schema 的验证。

重复注册的覆盖策略：
当前代码只是 warn 然后直接覆盖。在大型项目中，如果两个模块不小心起了相同的工具名，可能会产生难以排查的 Bug。

建议：增加一个可选参数 allowOverwrite?: boolean，默认为 false。

只读安全性：
getAll() 返回的是 [...this.tools.values()]，这虽然创建了新数组，但数组里的工具对象本身依然是引用传递。如果外部代码修改了返回的工具对象，会直接影响 Registry 内部。

建议：返回深拷贝的对象，或者将 ToolDefinition 的属性设为 readonly。
