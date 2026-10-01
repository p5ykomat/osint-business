import { getJson } from "../lib/http.js";
import { assertSiren, safeJson } from "../lib/normalize.js";
import type { SourceRef } from "../types.js";

const API_BASE =
  "https://www.bodacc.fr/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

interface BodaccResponse {
  total_count: number;
  results: Array<Record<string, unknown>>;
}

export type BodaccFamily =
  | "collective"
  | "creation"
  | "modification"
  | "radiation"
  | "dpc";

export function bodaccSource(): SourceRef {
  return {
    name: "BODACC, annonces commerciales",
    publisher: "DILA",
    url: "https://www.bodacc.fr/pages/donnees-ouvertes-et-api/",
    retrievedAt: new Date().toISOString(),
    status: "primary",
  };
}

export async function getBodaccHistory(
  value: string,
  options: { family?: BodaccFamily; limit?: number } = {},
): Promise<{
  siren: string;
  total: number;
  returned: number;
  records: Array<Record<string, unknown>>;
  source: SourceRef;
  coverage: string;
}> {
  const siren = assertSiren(value);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const clauses = [`registre="${siren}"`];
  if (options.family) clauses.push(`familleavis="${options.family}"`);

  const params = new URLSearchParams({
    where: clauses.join(" AND "),
    order_by: "dateparution DESC",
    limit: String(limit),
  });
  const response = await getJson<BodaccResponse>(`${API_BASE}?${params.toString()}`);
  const nestedFields = [
    "listepersonnes",
    "listeetablissements",
    "jugement",
    "acte",
    "modificationsgenerales",
    "radiationaurcs",
    "depot",
    "divers",
  ];
  const records = response.results.map((record) => {
    const normalized = { ...record };
    for (const field of nestedFields) normalized[field] = safeJson(normalized[field]);
    return normalized;
  });

  return {
    siren,
    total: response.total_count,
    returned: records.length,
    records,
    source: bodaccSource(),
    coverage:
      response.total_count > records.length
        ? `Partielle : ${records.length} annonces les plus récentes sur ${response.total_count}.`
        : `Complète pour le filtre demandé : ${records.length} annonce(s).`,
  };
}
