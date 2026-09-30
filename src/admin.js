// /admin page logic. Served from the same origin so the CSP can forbid inline scripts.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Snippets come from SQLite with <mark> tags around matches: escape everything else.
const safeSnippet = (s) => esc(s).replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
const md = (s) => DOMPurify.sanitize(marked.parse(s || ""));
const fmtDate = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const fmtCost = (c) => (c == null ? "—" : c < 0.01 ? `${(c * 100).toFixed(2)} ¢` : `${c.toFixed(3)} $`);
const fmtTok = (n) => (n >= 1000 ? `${Math.round(n / 1000)} k` : n);
const fb = (v) => (v === 1 ? '<span class="up">👍</span>' : v === -1 ? '<span class="down">👎</span>' : "");
const toolName = (n) => n.replace("__", " › ");

let page = 1;

async function loadStats() {
  const { days, retentionDays } = await (await fetch("/admin/api/stats")).json();
  $("#retention").textContent = `Conservation : ${retentionDays} jours · aucune adresse IP enregistrée`;
  $("#stats tbody").innerHTML = days.length
    ? days.map((d) => `<tr><td>${d.day}</td><td class="num">${d.questions}</td><td class="num">${d.conversations}</td><td class="num">${d.errors || ""}</td><td class="num">${d.up || ""}</td><td class="num">${d.down || ""}</td><td class="num">${d.avg_seconds} s</td><td class="num">${fmtCost(d.cost_usd)}</td></tr>`).join("")
    : `<tr><td colspan="8" class="empty">Aucune question pour l'instant.</td></tr>`;
}

async function loadTurns() {
  const f = new FormData($("#filters"));
  const params = new URLSearchParams({ page });
  if (f.get("q")) params.set("q", f.get("q"));
  if (f.get("feedback")) params.set("feedback", f.get("feedback"));
  if (f.get("errors")) params.set("errors", "1");
  const { total, rows, limit } = await (await fetch(`/admin/api/turns?${params}`)).json();
  $("#count").textContent = `${total} résultat${total > 1 ? "s" : ""}`;
  $("#turns tbody").innerHTML = rows.length
    ? rows.map((r) => `
      <tr data-session="${esc(r.session_id)}">
        <td class="when">${fmtDate(r.created_at)}${r.turn_index ? `<br>tour ${r.turn_index + 1}` : ""}</td>
        <td><div class="q">${esc(r.question)}</div>${r.snippet ? `<div class="snip">${safeSnippet(r.snippet)}</div>` : ""}</td>
        <td class="num">${JSON.parse(r.tools).length}</td>
        <td class="num">${(r.duration_ms / 1000).toFixed(0)} s</td>
        <td class="num">${fmtTok(r.input_tokens)} / ${fmtTok(r.output_tokens)}</td>
        <td class="num">${fmtCost(r.cost_usd)}</td>
        <td>${fb(r.feedback)} ${r.error ? '<span class="badge err">erreur</span>' : ""}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">Rien trouvé.</td></tr>`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page * limit >= total;
}

async function openSession(id) {
  const turns = await (await fetch(`/admin/api/session/${encodeURIComponent(id)}`)).json();
  $("#dlg-id").textContent = id;
  $("#dlg-body").innerHTML = turns.map((t) => {
    const tools = JSON.parse(t.tools);
    return `<div class="turn">
      <div class="meta"><span>${fmtDate(t.created_at)}</span><span>${esc(t.model)}</span><span>${(t.duration_ms / 1000).toFixed(1)} s</span><span>${t.input_tokens} → ${t.output_tokens} jetons</span><span>${fmtCost(t.cost_usd)}</span>${fb(t.feedback)}</div>
      <div class="user">${esc(t.question)}</div>
      <div class="answer">${md(t.answer)}</div>
      ${t.error ? `<div class="error">⚠ ${esc(t.error)}</div>` : ""}
      ${tools.length ? `<details class="tools"><summary>${tools.length} appel${tools.length > 1 ? "s" : ""} d'outil</summary><ol>${tools.map((c) => `<li><strong>${esc(toolName(c.name))}</strong> <code>${esc(JSON.stringify(c.input))}</code> · ${c.ms} ms${c.error ? ' <span class="badge err">erreur</span>' : ""}</li>`).join("")}</ol></details>` : ""}
    </div>`;
  }).join("");
  $("#dlg").showModal();
}

let timer;
$("#filters").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; loadTurns(); }, 250); });
$("#filters").addEventListener("submit", (e) => e.preventDefault());
$("#prev").addEventListener("click", () => { page--; loadTurns(); });
$("#next").addEventListener("click", () => { page++; loadTurns(); });
$("#turns tbody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-session]"); if (tr) openSession(tr.dataset.session); });
$("#dlg-close").addEventListener("click", () => $("#dlg").close());

loadStats();
loadTurns();
