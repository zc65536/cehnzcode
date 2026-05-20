/**
 * 解析示例：展示模型返回的 JSON → TaskPlan 对象 → 序列化回 JSON 的完整过程
 *
 * 运行：tsx src/planner/test/test-parse-example.ts
 */

process.env.API_KEY = "dummy";
process.env.LOG_LEVEL = "error";

const { PlanCreator } = await import("../creator.js");

// ─── 模拟模型返回的 JSON（新格式）───────────────────────────────────────────

const MODEL_RESPONSE = `
\`\`\`json
{
  "description": "实现一个带身份验证的 Todo API",
  "modules": [
    {
      "name": "数据模型",
      "description": "定义 User 和 Todo 的数据类型与数据库 schema",
      "dependsOn": [],
      "relatedModules": [],
      "inputs": [],
      "outputs": [
        { "name": "UserSchema", "description": "User 表结构与 TypeScript 类型" },
        { "name": "TodoSchema", "description": "Todo 表结构与 TypeScript 类型" }
      ]
    },
    {
      "name": "认证模块",
      "description": "实现注册、登录接口，生成并验证 JWT",
      "dependsOn": [0],
      "relatedModules": [],
      "inputs": [
        { "name": "UserSchema", "description": "User 表结构", "source": 0 }
      ],
      "outputs": [
        { "name": "authMiddleware", "description": "验证请求头中的 JWT，挂载 req.userId" },
        { "name": "POST /auth/register", "description": "用户注册接口" },
        { "name": "POST /auth/login", "description": "用户登录接口，返回 JWT" }
      ]
    },
    {
      "name": "Todo CRUD",
      "description": "实现 Todo 的增删改查接口，需要登录才能访问",
      "dependsOn": [0, 1],
      "relatedModules": [0],
      "inputs": [
        { "name": "TodoSchema", "description": "Todo 表结构", "source": 0 },
        { "name": "authMiddleware", "description": "请求鉴权中间件", "source": 1 }
      ],
      "outputs": [
        { "name": "GET /todos", "description": "获取当前用户的所有 Todo" },
        { "name": "POST /todos", "description": "创建新 Todo" },
        { "name": "PATCH /todos/:id", "description": "更新 Todo 状态" },
        { "name": "DELETE /todos/:id", "description": "删除 Todo" }
      ]
    }
  ],
  "metadata": {
    "estimatedDuration": 60,
    "complexity": "medium",
    "tags": ["api", "auth", "crud"]
  }
}
\`\`\`
`;

// ─── mock model（固定返回上面的 JSON）────────────────────────────────────────

const mockModel = {
  chat: async () => ({
    content: MODEL_RESPONSE,
    toolCalls: [],
    usage: { prompt: 0, completion: 0, total: 0 },
    finishReason: "stop",
  }),
};

// ─── 执行解析 ─────────────────────────────────────────────────────────────────

const creator = new PlanCreator(mockModel as any, {} as any);
const plan = await creator.create({ task: "实现带身份验证的 Todo API", discussionHistory: [] });

// ─── 打印结果 ─────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════");
console.log("  解析后的 TaskPlan 对象（关键字段）");
console.log("═══════════════════════════════════════════\n");

console.log(`plan.id          = ${plan.id}`);
console.log(`plan.description = ${plan.description}`);
console.log(`plan.status      = ${plan.status}`);
console.log(`plan.metadata    =`, plan.metadata);
console.log(`plan.modules.length = ${plan.modules.length}\n`);

for (const mod of plan.modules) {
  console.log(`── module[${mod.index}] ──────────────────────────`);
  console.log(`  id           = ${mod.id}`);
  console.log(`  name         = ${mod.name}`);
  console.log(`  description  = ${mod.description}`);
  console.log(`  dependsOn    = [${mod.dependsOn.join(", ")}]`);
  console.log(`  relatedModules = [${mod.relatedModules.join(", ")}]`);
  console.log(`  inputContract:`);
  for (const c of mod.inputContract) {
    console.log(`    { name: "${c.name}", sourceModule: "${c.sourceModule ?? "-"}" }`);
  }
  console.log(`  outputContract:`);
  for (const c of mod.outputContract) {
    console.log(`    { name: "${c.name}" }`);
  }
  console.log();
}

console.log("═══════════════════════════════════════════");
console.log("  序列化回 JSON（JSON.stringify）");
console.log("═══════════════════════════════════════════\n");

console.log(JSON.stringify(plan, null, 2));
