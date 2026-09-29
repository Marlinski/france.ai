// Télécharge les fiches pratiques de Service-Public.fr (DILA, Licence Ouverte 2.0,
// référencées sur data.gouv.fr) et les convertit en Markdown léger.
//
//   Particuliers : https://www.data.gouv.fr/datasets/fiches-pratiques-et-ressources-de-service-public-gouv-fr-particuliers
//   Entreprendre : https://www.data.gouv.fr/datasets/fiches-pratiques-et-ressources-entreprendre-service-public-gouv-fr

import { unzipSync, strFromU8 } from "fflate";
import type { Fiche } from "./fiches.ts";

const SOURCES = [
  { audience: "Particuliers", url: "https://lecomarquage.service-public.gouv.fr/vdd/3.5/part/zip/vosdroits-latest.zip" },
  { audience: "Professionnels", url: "https://lecomarquage.service-public.gouv.fr/vdd/3.5/pro/zip/vosdroits-latest.zip" },
];

// Resource types worth answering with (skip glossary entries, phone numbers, etc.).
const KEEP_TYPES = new Set([
  "Fiche d'information conditionnée",
  "Fiche Question-réponse conditionnée",
  "Fiche Comment faire si conditionné",
  "Fiche avec liens externes",
  "Dossier",
  "Téléservice",
  "Formulaire",
  "Modèle de document",
  "Simulateur",
]);

// Subtrees that are navigation or metadata, not content.
const SKIP = new Set([
  "FilDAriane", "Theme", "SousThemePere", "DossierPere", "Audience", "Canal", "SurTitre",
  "VoirAussi", "QuiPeutMAider", "Reference", "PourEnSavoirPlus", "Abreviation", "Montant",
  "InformationComplementaire", "Actualite", "Partenaire", "ServiceNoeud", "Definition",
  "TitreRiche", "Condition",
]);

const HEADING: Record<string, string> = {
  Situation: "# Situation : ", Chapitre: "## ", SousChapitre: "### ", Cas: "#### ",
  Attention: "> ", ANoter: "> ", ASavoir: "> ", SousDossier: "## ",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

const LINK_PARENTS = new Set(["ServiceEnLigne", "OuSAdresser", "LienWeb", "FicheLiee", "Fiche"]);

// Paragraphs nested in these stay on the same line.
const INLINE_PARENTS = new Set(["Titre", "Item", "Cellule"]);

/** Convert a DILA XML body to lightweight Markdown. */
function toMarkdown(xml: string): string {
  const out: string[] = [];
  // Each open element remembers what to emit when it closes.
  const stack: { name: string; close: string }[] = [];
  let skipDepth = 0;
  const re = /<(\/?)([A-Za-z:?!][^\s>/]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(xml)); ) {
    const [, closing, name, attrs, selfClosing, text] = m;
    if (text !== undefined) {
      if (!skipDepth) out.push(decode(text).replace(/\s+/g, " "));
      continue;
    }
    if (name.startsWith("?") || name.startsWith("!")) continue;
    const skippable = SKIP.has(name) || name.startsWith("dc:");
    if (closing) {
      const top = stack.pop();
      if (skippable) skipDepth--;
      else if (!skipDepth && top) out.push(top.close);
      continue;
    }
    const url = attr(attrs, "URL");
    if (selfClosing) {
      if (!skipDepth && url) out.push(` (${url})`);
      continue;
    }
    const parent = stack[stack.length - 1]?.name ?? "";
    const entry = { name, close: url ? ` (${url})` : "" };
    stack.push(entry);
    if (skippable) { skipDepth++; continue; }
    if (skipDepth) continue;
    switch (name) {
      case "Titre":
        if (HEADING[parent]) { out.push(`\n\n${HEADING[parent]}`); entry.close = "\n"; }
        else if (LINK_PARENTS.has(parent)) out.push("\n- ");
        else { out.push("\n\n**"); entry.close = "**\n"; }
        break;
      case "Paragraphe": out.push(INLINE_PARENTS.has(parent) ? " " : "\n\n"); break;
      case "Source": out.push(" — "); break;
      case "Item": out.push("\n- "); break;
      case "Rangee": out.push("\n|"); break;
      case "Cellule": entry.close = " |"; break;
      case "MiseEnEvidence": out.push("**"); entry.close = "**"; break;
    }
  }
  return out
    .join("")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/(#+|-|\*\*) +/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parse(xml: string, audience: string): Fiche | null {
  const root = xml.match(/<(Publication|ServiceComplementaire)\b([^>]*)>/);
  if (!root) return null;
  const type = attr(root[2], "type") ?? "";
  if (!KEEP_TYPES.has(type)) return null;
  const tag = (t: string) => decode(xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "").trim();
  const id = attr(root[2], "ID")!;
  const breadcrumb = [...(xml.match(/<FilDAriane>([\s\S]*?)<\/FilDAriane>/)?.[1] ?? "").matchAll(/<Niveau[^>]*>([^<]*)<\/Niveau>/g)]
    .map((m) => decode(m[1]))
    .slice(1, -1);
  const body = xml.slice(root.index! + root[0].length);
  const text = toMarkdown(body);
  return {
    id,
    audience,
    type,
    title: tag("dc:title"),
    description: tag("dc:description"),
    theme: tag("dc:subject"),
    breadcrumb: breadcrumb.join(" › "),
    date: tag("dc:date").replace("modified ", ""),
    url: attr(root[2], "spUrl") ?? `https://www.service-public.gouv.fr/${audience === "Particuliers" ? "particuliers" : "professionnels-entreprises"}/vosdroits/${id}`,
    link: attr(xml.match(/<LienWeb\b([^>]*)>/)?.[1] ?? "", "URL"),
    text,
  };
}

export async function downloadFiches(log: (msg: string) => void = () => {}): Promise<Fiche[]> {
  const fiches: Fiche[] = [];
  const seen = new Set<string>();
  for (const { audience, url } of SOURCES) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()), { filter: (f) => /^[FNR]\d+\.xml$/.test(f.name.split("/").pop()!) });
    let kept = 0;
    for (const data of Object.values(files)) {
      const fiche = parse(strFromU8(data), audience);
      // Some resources are published in both audiences; keep the first copy.
      if (fiche && !seen.has(fiche.id)) seen.add(fiche.id), fiches.push(fiche), kept++;
    }
    log(`${url} : ${Object.keys(files).length} fichiers, ${kept} retenus`);
  }
  return fiches;
}
