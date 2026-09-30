const $ = (s) => document.querySelector(s);
const thread = $("#thread");
const form = $("#composer");
const input = $("#q");
const send = $("#send");
const mic = $("#mic");
const newChat = $("#new-chat");

const T = { thinking: "Réflexion…", stopped: "Connexion interrompue. Réessayez.", tooMany: "Trop de questions. Réessayez plus tard." };

const TOOL_LABELS = {
  chercher_fiches_service_public: "Recherche dans les fiches Service-Public.fr",
  lire_fiche_service_public: "Lecture d'une fiche Service-Public.fr",
  search_datasets: "Recherche de jeux de données sur data.gouv.fr",
  get_dataset_info: "Consultation d'un jeu de données data.gouv.fr",
  list_dataset_resources: "Liste des fichiers d'un jeu de données",
  query_resource_data: "Lecture des données",
  get_resource_info: "Consultation d'un fichier de données",
  search_dataservices: "Recherche d'API publiques",
  get_dataservice_info: "Consultation d'une API publique",
  get_dataservice_openapi_spec: "Lecture de la documentation d'une API",
  search_organizations: "Recherche d'organismes producteurs de données",
  rechercher_service_local: "Recherche dans l'annuaire de l'administration",
  rechercher_entreprise: "Recherche dans l'annuaire des entreprises",
  consulter_sirene_historique: "Recherche dans le répertoire Sirene",
  consulter_fiscalite_locale: "Consultation de la fiscalité locale",
  rechercher_doctrine_fiscale: "Recherche dans la doctrine fiscale (BOFiP)",
  simuler_taxe_fonciere: "Simulation de taxe foncière",
  simuler_frais_notaire: "Simulation des frais de notaire",
  simuler_impot_revenu: "Simulation de l'impôt sur le revenu",
  consulter_zonage_immobilier: "Consultation du zonage immobilier",
  comparer_communes: "Comparaison de communes",
  rechercher_convention_collective: "Recherche de convention collective",
  rechercher_offre_emploi: "Recherche d'offres d'emploi (France Travail)",
  rechercher_formation: "Recherche de formations (CPF)",
  rechercher_texte_legal: "Recherche dans les textes de loi",
  rechercher_code_juridique: "Recherche dans les codes juridiques",
  consulter_journal_officiel: "Recherche au Journal officiel",
  rechercher_jurisprudence: "Recherche de jurisprudence",
  rechercher_annonce_legale: "Recherche dans le BODACC",
  rechercher_marche_public: "Recherche de marchés publics (BOAMP)",
  rechercher_subvention: "Recherche de subventions",
  rechercher_etablissement_scolaire: "Recherche d'établissements scolaires",
  consulter_resultats_lycee: "Consultation des résultats d'un lycée",
  consulter_evaluations_nationales: "Consultation des évaluations nationales",
  consulter_parcoursup: "Recherche sur Parcoursup",
  consulter_parcoursup_stats: "Statistiques Parcoursup",
  consulter_insertion_professionnelle: "Consultation de l'insertion professionnelle",
  consulter_acces_soins: "Consultation de l'accès aux soins",
  consulter_aide_sociale: "Consultation des statistiques CAF",
  consulter_securite: "Consultation des statistiques de sécurité",
  consulter_risques_naturels: "Consultation des risques naturels (Géorisques)",
  consulter_prix_carburant: "Consultation des prix des carburants",
  consulter_budget_commune: "Consultation du budget d'une commune",
  consulter_budget_epci: "Consultation du budget d'une intercommunalité",
};
const labelFor = (tool, server) =>
  TOOL_LABELS[tool] ?? (server === "datagouv" ? "Consultation de data.gouv.fr" : "Consultation des données publiques");

// ——— markdown ———
marked.setOptions({ breaks: false, gfm: true });
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});
const render = (md) => DOMPurify.sanitize(marked.parse(md));

// ——— session ———
// Conversation history lives server-side; each page load starts a fresh one.
const newSession = () => crypto.randomUUID();
let sessionId = newSession();
let busy = false;

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  input.style.overflowY = input.scrollHeight > 200 ? "auto" : "hidden";
  send.disabled = busy || !input.value.trim();
}
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});
form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
document.querySelectorAll(".suggestions button").forEach((b) => b.addEventListener("click", () => ask(b.dataset.q)));
newChat.addEventListener("click", () => {
  sessionId = newSession();
  thread.replaceChildren();
  document.body.classList.remove("chatting");
  newChat.hidden = true;
  input.focus();
});

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  input.value = "";
  autosize();

// Shareable links: https://france.re/?q=Comment+renouveler+mon+passeport
const shared = new URLSearchParams(location.search).get("q");
if (shared) {
  history.replaceState(null, "", location.pathname);
  ask(shared);
}
  document.body.classList.add("chatting");
  newChat.hidden = false;

  const user = el("div", "msg-user");
  user.textContent = text;
  const bot = el("div", "msg-bot");
  const steps = el("div", "steps");
  const answer = el("div", "answer", `<span class="typing" aria-label="${T.thinking}"><i></i><i></i><i></i></span>`);
  bot.append(steps, answer);
  thread.append(user, bot);
  user.scrollIntoView({ behavior: "smooth", block: "start" });

  let md = "";
  let frame = 0;
  const flush = () => { frame = 0; answer.innerHTML = render(md); };
  const setStep = (label) => {
    steps.querySelectorAll(".step.active").forEach((s) => s.classList.remove("active"));
    if (label) steps.append(Object.assign(el("div", "step active"), { textContent: label }));
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(res.status === 429 ? T.tooMany : err.error ?? T.stopped);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const ev = JSON.parse(data);
        if (ev.type === "status") {
          // Text written before a tool call is the model thinking aloud ("Je vais chercher…"),
          // not the answer: keep it as a progress note and start the answer afresh.
          if (md.trim()) {
            if (frame) cancelAnimationFrame(frame), (frame = 0);
            steps.append(Object.assign(el("div", "step note"), { textContent: md.trim().replace(/\s+/g, " ").slice(0, 200) }));
            md = "";
            answer.innerHTML = `<span class="typing" aria-label="${T.thinking}"><i></i><i></i><i></i></span>`;
          }
          setStep(labelFor(ev.tool, ev.server));
        }
        else if (ev.type === "text") {
          if (!md) setStep(null);
          md += ev.text;
          frame ||= requestAnimationFrame(flush);
        } else if (ev.type === "error") {
          setStep(null);
          answer.append(Object.assign(el("p", "error"), { textContent: ev.message }));
        }
      }
    }
    setStep(null);
    if (md) flush();
    else answer.querySelector(".typing")?.remove();
  } catch (err) {
    setStep(null);
    answer.querySelector(".typing")?.remove();
    answer.append(Object.assign(el("p", "error"), { textContent: err.message || T.stopped }));
  } finally {
    busy = false;
    autosize();

// Shareable links: https://france.re/?q=Comment+renouveler+mon+passeport
const shared = new URLSearchParams(location.search).get("q");
if (shared) {
  history.replaceState(null, "", location.pathname);
  ask(shared);
}
    input.focus();
  }
}

// ——— voice input (Web Speech API, where available) ———
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  mic.hidden = false;
  let rec = null;
  mic.addEventListener("click", () => {
    if (rec) return rec.stop();
    rec = new Recognition();
    rec.lang = "fr-FR";
    rec.interimResults = true;
    const base = input.value ? input.value + " " : "";
    rec.onresult = (e) => {
      input.value = base + Array.from(e.results).map((r) => r[0].transcript).join("");
      autosize();

// Shareable links: https://france.re/?q=Comment+renouveler+mon+passeport
const shared = new URLSearchParams(location.search).get("q");
if (shared) {
  history.replaceState(null, "", location.pathname);
  ask(shared);
}
    };
    rec.onend = () => { rec = null; mic.classList.remove("listening"); input.focus(); };
    mic.classList.add("listening");
    rec.start();
  });
}

autosize();

// Shareable links: https://france.re/?q=Comment+renouveler+mon+passeport
const shared = new URLSearchParams(location.search).get("q");
if (shared) {
  history.replaceState(null, "", location.pathname);
  ask(shared);
}
