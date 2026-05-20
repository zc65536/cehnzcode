// src/planner/dependency-graph.ts

import type { DependencyGraph, Module } from "./types.js";
import { createChildLogger } from "../logger/index.js";

const logger = createChildLogger("planner:dependency-graph");

/** 依赖图：构建模块依赖关系，支持就绪检测和环路检测 */
export class DependencyGraphImpl implements DependencyGraph {
  nodes: Map<string, Module>;
  edges: Map<string, Set<string>>;

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  addModule(module: Module): void {
    logger.debug({ moduleId: module.id }, "Adding module to graph");

    this.nodes.set(module.id, module);
    this.edges.set(module.id, new Set(module.dependsOn));
  }

  /**
   * 检测是否存在循环依赖，使用 DFS + 递归栈
   * Phase 3 实现
   */
  hasCircularDependency(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (this.hasCycleFrom(nodeId, visited, recStack)) {
          return true;
        }
      }
    }

    return false;
  }

  /** 返回所有依赖已完成（status === "done"）的 pending 模块 */
  getReadyModules(): Module[] {
    const ready: Module[] = [];

    for (const [nodeId, module] of this.nodes) {
      if (module.status !== "pending") continue;

      // 检查所有直接依赖是否已完成
      const deps = this.edges.get(nodeId) ?? new Set<string>();
      const allDepsFinished = [...deps].every(depId => {
        const dep = this.nodes.get(depId);
        return dep?.status === "done";
      });

      if (allDepsFinished) {
        ready.push(module);
      }
    }

    return ready;
  }

  /** 返回拓扑排序后的模块 id 列表（DFS 后序遍历） */
  getExecutionOrder(): string[] {
    const order: string[] = [];
    const visited = new Set<string>();

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const deps = this.edges.get(nodeId) ?? new Set<string>();
      for (const depId of deps) {
        visit(depId);
      }

      order.push(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    return order;
  }

  /** DFS 辅助函数：从 nodeId 出发检测环路 */
  private hasCycleFrom(nodeId: string, visited: Set<string>, recStack: Set<string>): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);

    const dependencies = this.edges.get(nodeId) ?? new Set<string>();
    for (const depId of dependencies) {
      if (recStack.has(depId)) {
        // 在递归栈中找到了，说明有环
        return true;
      }
      if (!visited.has(depId)) {
        if (this.hasCycleFrom(depId, visited, recStack)) {
          return true;
        }
      }
    }

    recStack.delete(nodeId);
    return false;
  }
}
