import { getMCPManager } from "../../mcp/index.js";
import type { CommandDefinition, CommandContext } from "../types.js";
import type { MCPServerConfig } from "../../mcp/types.js";

export const mcpCommand: CommandDefinition = {
  name: "mcp",
  description: "Manage MCP servers (add/list/remove/reload)",

  async execute(args: string, ctx: CommandContext) {
    const [subcommand, ...rest] = args.trim().split(/\s+/);
    const mcpManager = getMCPManager();

    switch (subcommand) {
      case "add":
        await handleAdd(rest, ctx, mcpManager);
        break;

      case "list":
        await handleList(ctx, mcpManager);
        break;

      case "remove":
        await handleRemove(rest, ctx, mcpManager);
        break;

      case "reload":
        await handleReload(ctx, mcpManager);
        break;

      default:
        console.log(
          "Usage: /mcp <add|list|remove|reload> [args]\n" +
            "Examples:\n" +
            "  /mcp add fetch uvx mcp-server-fetch\n" +
            "  /mcp add fetch uvx mcp-server-fetch --project\n" +
            "  /mcp list\n" +
            "  /mcp remove fetch\n" +
            "  /mcp reload"
        );
    }
  },
};

async function handleAdd(
  args: string[],
  ctx: CommandContext,
  mcpManager: ReturnType<typeof getMCPManager>
) {
  const isProject = args.includes("--project");
  const cleanArgs = args.filter((a) => a !== "--project");

  if (cleanArgs.length < 2) {
    console.error("Usage: /mcp add <name> <command> [...args] [--project]");
    return;
  }

  const [name, command, ...cmdArgs] = cleanArgs;
  const level = isProject ? "project" : "system";

  const config: MCPServerConfig = {
    transport: "stdio",
    command,
    args: cmdArgs,
    disabled: false,
  };

  try {
    await mcpManager.addServer(name, config, level);
    console.log(`✓ MCP server '${name}' added to ${level} config`);
  } catch (error) {
    console.error(`✗ Failed to add MCP server: ${(error as Error).message}`);
  }
}

async function handleList(
  ctx: CommandContext,
  mcpManager: ReturnType<typeof getMCPManager>
) {
  const servers = mcpManager.getAllServers();

  if (servers.length === 0) {
    console.log("No MCP servers configured");
    return;
  }

  console.log("MCP Servers:");
  for (const server of servers) {
    const status = server.status === "connected" ? "✓" : "✗";
    const toolCount = server.tools.length;
    console.log(`  ${status} ${server.name} (${toolCount} tools)`);

    if (server.status === "error" && server.error) {
      console.log(`    Error: ${server.error.message}`);
    }
  }
}

async function handleRemove(
  args: string[],
  ctx: CommandContext,
  mcpManager: ReturnType<typeof getMCPManager>
) {
  const isProject = args.includes("--project");
  const cleanArgs = args.filter((a) => a !== "--project");

  if (cleanArgs.length !== 1) {
    console.error("Usage: /mcp remove <name> [--project]");
    return;
  }

  const [name] = cleanArgs;
  const level = isProject ? "project" : "system";

  try {
    await mcpManager.removeServer(name, level);
    console.log(`✓ MCP server '${name}' removed from ${level} config`);
  } catch (error) {
    console.error(`✗ Failed to remove MCP server: ${(error as Error).message}`);
  }
}

async function handleReload(
  ctx: CommandContext,
  mcpManager: ReturnType<typeof getMCPManager>
) {
  try {
    console.log("Reloading MCP servers (disconnecting all connections)...");
    await mcpManager.reload();
    console.log("✓ MCP servers reloaded");
  } catch (error) {
    console.error(`✗ Failed to reload MCP servers: ${(error as Error).message}`);
  }
}
