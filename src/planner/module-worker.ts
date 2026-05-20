// src/planner/module-worker.ts
// 子进程入口：执行单个模块的 agentic loop，完成后向主进程发送 ModuleResult

// Phase 4 实现
// 运行方式：fork("src/planner/module-worker.ts", [moduleId, planId])
// 主进程通过 IPC 接收 ModuleResult

throw new Error("Not implemented: module-worker");
