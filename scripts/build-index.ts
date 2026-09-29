// Pré-génère data/fiches.json (embarqué dans l'image) pour un démarrage sans téléchargement.

import { mkdir, writeFile } from "node:fs/promises";
import { downloadFiches } from "../src/dila.ts";

const fiches = await downloadFiches(console.log);
await mkdir("data", { recursive: true });
await writeFile("data/fiches.json", JSON.stringify({ generatedAt: new Date().toISOString(), fiches }));
console.log(`✓ data/fiches.json : ${fiches.length} fiches`);
