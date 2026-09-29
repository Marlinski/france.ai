import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { z } from "zod";
import { chat, MCP_SERVERS } from "./agent.ts";
import { initMcp } from "./mcp.ts";
import { downloadFiches } from "./dila.ts";
import { indexInfo, loadFiches, setFiches } from "./fiches.ts";

const PORT = Number(process.env.PORT ?? 3000);
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 30); // questions per IP per hour

const hits = new Map<string, number[]>();
function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) if (ts.every((t) => now - t >= 3600_000)) hits.delete(ip);
}, 600_000).unref();

const ChatBody = z.object({
  sessionId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
});

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true, fiches: indexInfo }));

app.post("/api/chat", async (c) => {
  const body = ChatBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Requête invalide" }, 400);
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? getConnInfo(c).remote.address ?? "?";
  if (!allow(ip)) return c.json({ error: "Trop de questions en peu de temps. Réessayez plus tard." }, 429);

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    for await (const event of chat(body.data.sessionId, body.data.message, abort.signal)) {
      await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    }
  });
});

app.use("/*", serveStatic({ root: "./public" }));

// Start from the snapshot baked into the image, then follow DILA's daily updates.
async function refresh() {
  try {
    await setFiches(await downloadFiches());
    console.log(`fiches Service-Public mises à jour : ${indexInfo.count}`);
  } catch (err) {
    console.error("mise à jour des fiches impossible :", err);
  }
}
try {
  await loadFiches();
  console.log(`${indexInfo.count} fiches Service-Public chargées (${indexInfo.generatedAt})`);
  if (Date.now() - Date.parse(indexInfo.generatedAt) > 86400_000) void refresh();
} catch {
  console.log("pas d'instantané local, téléchargement des fiches…");
  await refresh();
}
setInterval(refresh, 86400_000).unref();
await initMcp(MCP_SERVERS);
serve({ fetch: app.fetch, port: PORT }, (info) => console.log(`france.re → http://localhost:${info.port}`));
