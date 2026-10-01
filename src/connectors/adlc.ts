import { csvObjects } from "../lib/csv.js";
import { getJson, getText } from "../lib/http.js";
import { normalizeText } from "../lib/normalize.js";
import type { SourceRef } from "../types.js";

const DATASET_ID = "6137832b5c047eb2ea6c9a34";
const DATASET_URL =
  "https://www.data.gouv.fr/datasets/entreprises-sanctionnees-financierement-par-lautorite-de-la-concurrence-depuis-2009";

interface DatasetMetadata {
  resources: Array<{
    title?: string;
    format?: string;
    url: string;
    last_modified?: string;
  }>;
}

let cache: { expiresAt: number; rows: Array<Record<string, string>>; resourceUrl: string } | undefined;

async function loadSanctions(): Promise<typeof cache extends undefined ? never : NonNullable<typeof cache>> {
  if (cache && cache.expiresAt > Date.now()) return cache;
  const metadata = await getJson<DatasetMetadata>(
    `https://www.data.gouv.fr/api/1/datasets/${DATASET_ID}/`,
  );
  const resource = metadata.resources.find(
    (candidate) =>
      candidate.format?.toLowerCase() === "csv" &&
      candidate.title?.toLowerCase().includes("sanctions"),
  );
  if (!resource) throw new Error("Ressource CSV AdlC introuvable dans data.gouv.fr.");
  const rows = csvObjects(await getText(resource.url, 30_000));
  cache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, rows, resourceUrl: resource.url };
  return cache;
}

export async function searchAdlcSanctions(query: string): Promise<{
  query: string;
  matches: Array<Record<string, string | number | null>>;
  source: SourceRef;
  resourceUrl: string;
  limitations: string[];
}> {
  const dataset = await loadSanctions();
  const normalizedQuery = normalizeText(query);
  const matches = dataset.rows
    .filter((row) => normalizeText(row.Entreprise ?? "").includes(normalizedQuery))
    .map((row) => ({
      decisionId: row.id_decision ?? null,
      company: row.Entreprise ?? null,
      individualAmount: Number(row["Montant individuel"] ?? "") || 0,
      totalDecisionAmount: Number(row["Montant total"] ?? "") || 0,
      year: Number(row.Annee ?? "") || null,
    }));

  return {
    query,
    matches,
    source: {
      name: "Entreprises sanctionnées financièrement par l’Autorité de la concurrence depuis 2009",
      publisher: "Autorité de la concurrence",
      url: DATASET_URL,
      retrievedAt: new Date().toISOString(),
      status: "primary",
    },
    resourceUrl: dataset.resourceUrl,
    limitations: [
      "Les montants sont ceux publiés avant les éventuels appels et recours.",
      "La correspondance textuelle doit être confirmée par la décision source en cas de dénomination ambiguë.",
    ],
  };
}
