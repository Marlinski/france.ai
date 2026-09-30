import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { basicAuth } from "hono/basic-auth";
import { chat, MCP_SERVERS } from "./agent.ts";
import { exportAll, getSession, listTurns, purgeOld, RETENTION_DAYS, setFeedback, stats } from "./db.ts";
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

// Browsers stick to HTTPS for a year once they have seen the site over it.
app.use("*", async (c, next) => {
  await next();
  c.header("Strict-Transport-Security", "max-age=31536000");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

// Markdown rendering and sanitising, served from here rather than a CDN: a
// compromised third party must not be able to run code next to /admin.
const vendor = (file: string) => {
  const body = readFileSync(new URL(`../node_modules/${file}`, import.meta.url), "utf8");
  return (c: Context) => c.body(body, 200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" });
};
app.get("/vendor/marked.js", vendor("marked/lib/marked.umd.js"));
app.get("/vendor/purify.js", vendor("dompurify/dist/purify.min.js"));

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

const FeedbackBody = z.object({
  sessionId: z.string().uuid(),
  turnId: z.number().int().positive(),
  value: z.union([z.literal(1), z.literal(-1), z.null()]),
});

app.post("/api/feedback", async (c) => {
  const body = FeedbackBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Requête invalide" }, 400);
  return setFeedback(body.data.turnId, body.data.sessionId, body.data.value) ? c.json({ ok: true }) : c.json({ error: "Introuvable" }, 404);
});

// ——— admin: the question journal, behind basic auth; absent unless ADMIN_PASSWORD is set ———
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (ADMIN_PASSWORD) {
  const adminPage = readFileSync(new URL("./admin.html", import.meta.url), "utf8");
  const adminScript = readFileSync(new URL("./admin.js", import.meta.url), "utf8");
  app.use("/admin/*", basicAuth({ username: "admin", password: ADMIN_PASSWORD, realm: "france.re admin" }));
  app.use("/admin", basicAuth({ username: "admin", password: ADMIN_PASSWORD, realm: "france.re admin" }));
  app.use("/admin/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
  });
  // Visitors' questions and the model's answers are shown here, so treat them as hostile:
  // no inline or third-party script, no requests anywhere but this origin, no framing.
  app.use("/admin", async (c, next) => {
    await next();
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
  });
  app.get("/admin/app.js", (c) => c.body(adminScript, 200, { "Content-Type": "text/javascript; charset=utf-8" }));
  app.get("/admin", (c) => c.html(adminPage));
  app.get("/admin/api/turns", (c) => {
    const { q, feedback, errors, page } = c.req.query();
    const limit = 50;
    return c.json({
      ...listTurns({ q, feedback: feedback === "up" || feedback === "down" ? feedback : undefined, errors: errors === "1", limit, offset: (Math.max(1, Number(page) || 1) - 1) * limit }),
      limit,
    });
  });
  app.get("/admin/api/session/:id", (c) => c.json(getSession(c.req.param("id"))));
  app.get("/admin/api/stats", (c) => c.json({ days: stats(Number(c.req.query("days")) || 30), retentionDays: RETENTION_DAYS }));
  app.get("/admin/export.json", (c) => {
    c.header("Content-Disposition", `attachment; filename="france-re-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(exportAll());
  });
}

// ——— analytics: Umami at stats.marlinski.org, absent unless UMAMI_WEBSITE_ID is set ———
// Injected into the served page, so switching it off needs no rebuild.
// data-domains keeps local runs from reporting (UMAMI_DOMAINS, comma-separated).
const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID;
if (UMAMI_WEBSITE_ID) {
  const script = process.env.UMAMI_SCRIPT ?? "https://stats.marlinski.org/script.js";
  const domains = process.env.UMAMI_DOMAINS ?? "france.re,france.marlinski.org";
  const tag = `<script defer src="${script}" data-website-id="${UMAMI_WEBSITE_ID}" data-domains="${domains}"></script>`;
  const index = readFileSync("./public/index.html", "utf8").replace("</head>", `  ${tag}\n</head>`);
  app.get("/", (c) => c.html(index));
  app.get("/index.html", (c) => c.html(index));
}

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

const purge = () => {
  const n = purgeOld();
  if (n) console.log(`journal : ${n} questions de plus de ${RETENTION_DAYS} jours supprimées`);
};
purge();
setInterval(purge, 86400_000).unref();
if (!ADMIN_PASSWORD) console.log("ADMIN_PASSWORD absent : /admin désactivé");
serve({ fetch: app.fetch, port: PORT }, (info) => console.log(`france.re → http://localhost:${info.port}`));
