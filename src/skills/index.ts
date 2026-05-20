import { SkillRegistry } from "./registry.js";

export { SkillRegistry } from "./registry.js";
export type { SkillDefinition, SkillSource, DomainIndex, ISkillRegistry } from "./types.js";

/** 全局单例，供 use_skill tool、/skill 命令、orchestrator 共享 */
export const skillRegistry = new SkillRegistry();
