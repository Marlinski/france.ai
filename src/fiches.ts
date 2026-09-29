// Full-text search over Service-Public.fr practical guides (built by scripts/build-index.ts).

import { readFile } from "node:fs/promises";
import MiniSearch from "minisearch";

export interface Fiche {
  id: string;
  audience: string;
  type: string;
  title: string;
  description: string;
  theme: string;
  breadcrumb: string;
  date: string;
  url: string;
  /** External service URL for téléservices / forms. */
  link?: string;
  text: string;
}

const STOPWORDS = new Set(
  "a au aux avec ce ces comment dans de des du en est et il je la le les leur ma mais me mes mon ne nous on ou par pas pour qu que qui quoi sa se ses son sur ta te tes ton tu un une vos votre vous y d l j m n s t c est-ce faire faut peut peux dois doit".split(" "),
);

/** Lowercase, strip accents, drop stopwords and crude French plural/feminine endings. */
function processTerm(term: string): string | null {
  const t = term.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (t.length < 2 || STOPWORDS.has(t)) return null;
  return t.length > 4 ? t.replace(/(aux|eaux|s|x|e|es)$/, "") : t;
}

let fiches = new Map<string, Fiche>();
let index: MiniSearch<Fiche> | null = null;
export let indexInfo = { count: 0, generatedAt: "" };

export async function loadFiches(path = "data/fiches.json"): Promise<void> {
  const { generatedAt, fiches: list } = JSON.parse(await readFile(path, "utf8")) as { generatedAt: string; fiches: Fiche[] };
  await setFiches(list, generatedAt);
}

/** Build a fresh index, then swap it in: searches keep hitting the old one meanwhile. */
export async function setFiches(list: Fiche[], generatedAt = new Date().toISOString()): Promise<void> {
  const ms = new MiniSearch<Fiche>({
    fields: ["title", "description", "breadcrumb", "text"],
    storeFields: [],
    processTerm,
    // The opening of a fiche carries its vocabulary; indexing whole bodies costs ~4x the memory for little recall.
    extractField: (doc, field) => (field === "text" ? doc.text.slice(0, 2500) : doc[field as keyof Fiche] ?? ""),
    searchOptions: { boost: { title: 5, description: 2, breadcrumb: 1.5 }, fuzzy: 0.15, prefix: true, combineWith: "OR" },
  });
  await ms.addAllAsync(list, { chunkSize: 500 });
  fiches = new Map(list.map((f) => [f.id, f]));
  index = ms;
  indexInfo = { count: list.length, generatedAt };
}

export function searchFiches(query: string, audience?: "Particuliers" | "Professionnels", limit = 8) {
  if (!index) throw new Error("Index des fiches non chargé");
  return index
    .search(query, audience ? { filter: (r) => fiches.get(r.id)?.audience === audience } : undefined)
    .slice(0, limit)
    .map((r) => {
      const f = fiches.get(r.id)!;
      return { id: f.id, title: f.title, type: f.type, audience: f.audience, breadcrumb: f.breadcrumb, description: f.description, url: f.url, ...(f.link && { link: f.link }) };
    });
}

export function getFiche(id: string): Fiche | undefined {
  return fiches.get(id.trim().toUpperCase());
}
