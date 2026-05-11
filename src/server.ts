import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AccountStore } from "./accounts.js";
import { ClientRegistry } from "./client-registry.js";
import { getAccountsDir } from "./config.js";
import { handleCallTool, handleListTools } from "./handlers.js";

export function createServer(deps?: { store?: AccountStore; registry?: ClientRegistry }): Server {
  const store = deps?.store ?? new AccountStore(getAccountsDir());
  const registry = deps?.registry ?? new ClientRegistry(store);

  const server = new Server({ name: "gmail-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => handleListTools() as unknown as { tools: unknown[] });

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleCallTool(request.params.name, (request.params.arguments ?? {}) as Record<string, any>, { store, registry }) as unknown as { content: unknown[] },
  );

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("gmail-mcp server running on stdio");
}
