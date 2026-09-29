// Client-side bridge to remote MCP servers: their tools are offered to Claude as
// ordinary tools and executed from here. This works with any Messages API
// provider (OpenRouter does not support Anthropic's server-side MCP connector).

import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpServerConfig {
  /** Short name, used as the tool-name prefix (`<name>__<tool>`). */
  name: string;
  url: string;
  /** Tools not offered to the model. */
  exclude?: string[];
}

interface Connected {
  config: McpServerConfig;
  client: Client | null;
  tools: Anthropic.Beta.BetaTool[];
}

const SEP = "__";
const CALL_TIMEOUT = 45_000;
const MAX_RESULT = 20_000;

const servers = new Map<string, Connected>();

async function connect(config: McpServerConfig): Promise<Client> {
  const client = new Client({ name: "france.re", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url)));
  return client;
}

async function listTools(conn: Connected): Promise<void> {
  conn.client ??= await connect(conn.config);
  const { tools } = await conn.client.listTools();
  conn.tools = tools
    .filter((t) => !conn.config.exclude?.includes(t.name))
    .map((t) => ({
      name: `${conn.config.name}${SEP}${t.name}`,
      description: (t.description ?? "").trim().slice(0, 1500),
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Connect to every server and cache its tool listing; a server that is down is skipped and retried later. */
export async function initMcp(configs: McpServerConfig[]): Promise<void> {
  for (const config of configs) servers.set(config.name, { config, client: null, tools: [] });
  await refreshMcpTools();
  setInterval(refreshMcpTools, 3600_000).unref();
}

export async function refreshMcpTools(): Promise<void> {
  await Promise.all(
    [...servers.values()].map(async (conn) => {
      try {
        await listTools(conn);
        console.log(`MCP ${conn.config.name} : ${conn.tools.length} outils`);
      } catch (err) {
        conn.client = null;
        console.error(`MCP ${conn.config.name} injoignable :`, (err as Error).message);
      }
    }),
  );
}

/** Snapshot of the currently available MCP tools. Sessions keep the one they started with. */
export function mcpTools(): Anthropic.Beta.BetaTool[] {
  return [...servers.values()].flatMap((s) => s.tools);
}

export function isMcpTool(name: string): boolean {
  return servers.has(name.split(SEP)[0]) && name.includes(SEP);
}

/** Map a tool name the model wrote without its server prefix back to the one MCP tool it names, if unambiguous. */
export function resolveMcpName(name: string): string | undefined {
  const matches = mcpTools().filter((t) => t.name.endsWith(SEP + name));
  return matches.length === 1 ? matches[0].name : undefined;
}

export function splitMcpName(name: string): { server: string; tool: string } {
  const i = name.indexOf(SEP);
  return { server: name.slice(0, i), tool: name.slice(i + SEP.length) };
}

export async function callMcpTool(name: string, input: unknown): Promise<{ content: string; isError?: boolean }> {
  const { server, tool } = splitMcpName(name);
  const conn = servers.get(server);
  if (!conn) return { content: `Serveur MCP inconnu : ${server}`, isError: true };
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  for (let attempt = 0; ; attempt++) {
    try {
      conn.client ??= await connect(conn.config);
      const result = await conn.client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT });
      const parts = Array.isArray(result.content) ? result.content : [];
      let text = parts.map((p) => (p.type === "text" ? p.text : `[contenu ${p.type} omis]`)).join("\n");
      if (!text && result.structuredContent) text = JSON.stringify(result.structuredContent);
      if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + "\n[… résultat tronqué]";
      return { content: text || "(résultat vide)", ...(result.isError ? { isError: true } : {}) };
    } catch (err) {
      // A dropped session is re-established once; anything else goes back to the model.
      conn.client = null;
      if (attempt >= 1) return { content: `Erreur du serveur ${server} : ${(err as Error).message}`, isError: true };
    }
  }
}
