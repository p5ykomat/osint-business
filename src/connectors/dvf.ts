import { gunzipSync } from "node:zlib";
import { csvObjects } from "../lib/csv.js";
import { request } from "../lib/http.js";
import { normalizeText } from "../lib/normalize.js";
import type { SourceRef } from "../types.js";

export interface DvfPropertyQuery {
  year: number;
  department: string;
  streetNumber: string;
  streetName: string;
  postalCode?: string;
  targetValue?: number;
  valueTolerance?: number;
  dateFrom?: string;
  dateTo?: string;
  maxMutations?: number;
}

interface DvfPropertyRow {
  localType?: string;
  builtSurface?: number;
  rooms?: number;
  lots: Array<{ number: string; carrezSurface?: number }>;
}

interface DvfMutation {
  mutationId: string;
  date: string;
  nature: string;
  value?: number;
  address: {
    number: string;
    street: string;
    postalCode: string;
    commune: string;
  };
  parcelIds: string[];
  properties: DvfPropertyRow[];
  sourceRows: number;
}

function officialDvfSource(year: number, department: string): SourceRef {
  return {
    name: `Demandes de valeurs foncières géolocalisées ${year}, département ${department}`,
    publisher: "Direction générale des Finances publiques / data.gouv.fr",
    url: `https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/departements/${department}.csv.gz`,
    retrievedAt: new Date().toISOString(),
    status: "primary",
  };
}

function numeric(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function propertyFromRow(row: Record<string, string>): DvfPropertyRow {
  const lots: DvfPropertyRow["lots"] = [];
  for (let index = 1; index <= 5; index += 1) {
    const number = row[`lot${index}_numero`];
    if (!number) continue;
    const carrezSurface = numeric(row[`lot${index}_surface_carrez`]);
    lots.push({ number, ...(carrezSurface === undefined ? {} : { carrezSurface }) });
  }
  const builtSurface = numeric(row.surface_reelle_bati);
  const rooms = numeric(row.nombre_pieces_principales);
  return {
    ...(row.type_local ? { localType: row.type_local } : {}),
    ...(builtSurface === undefined ? {} : { builtSurface }),
    ...(rooms === undefined ? {} : { rooms }),
    lots,
  };
}

function propertyKey(property: DvfPropertyRow): string {
  return JSON.stringify(property);
}

export function groupDvfRows(rows: Array<Record<string, string>>): DvfMutation[] {
  const grouped = new Map<
    string,
    DvfMutation & { parcelSet: Set<string>; propertyKeys: Set<string> }
  >();
  for (const row of rows) {
    const mutationId = row.id_mutation;
    if (!mutationId) continue;
    let mutation = grouped.get(mutationId);
    if (!mutation) {
      const value = numeric(row.valeur_fonciere);
      mutation = {
        mutationId,
        date: row.date_mutation ?? "",
        nature: row.nature_mutation ?? "",
        ...(value === undefined ? {} : { value }),
        address: {
          number: row.adresse_numero ?? "",
          street: row.adresse_nom_voie ?? "",
          postalCode: row.code_postal ?? "",
          commune: row.nom_commune ?? "",
        },
        parcelIds: [],
        properties: [],
        sourceRows: 0,
        parcelSet: new Set<string>(),
        propertyKeys: new Set<string>(),
      };
      grouped.set(mutationId, mutation);
    }
    mutation.sourceRows += 1;
    if (row.id_parcelle && !mutation.parcelSet.has(row.id_parcelle)) {
      mutation.parcelSet.add(row.id_parcelle);
      mutation.parcelIds.push(row.id_parcelle);
    }
    const property = propertyFromRow(row);
    const key = propertyKey(property);
    if (!mutation.propertyKeys.has(key)) {
      mutation.propertyKeys.add(key);
      mutation.properties.push(property);
    }
  }
  return [...grouped.values()].map(({ parcelSet: _parcelSet, propertyKeys: _keys, ...item }) => item);
}

export async function queryDvfPropertyTransactions(input: DvfPropertyQuery) {
  const currentYear = new Date().getUTCFullYear();
  const latestExpectedYear = currentYear - 1;
  const earliestExpectedYear = latestExpectedYear - 4;
  if (
    !Number.isInteger(input.year) ||
    input.year < earliestExpectedYear ||
    input.year > latestExpectedYear
  ) {
    throw new Error(
      `Année hors fenêtre DVF courante : utiliser une année entre ${earliestExpectedYear} et ${latestExpectedYear}, puis Parcellaire pour l’historique antérieur.`,
    );
  }
  const department = input.department.trim().toUpperCase();
  if (!/^(?:\d{2,3}|2A|2B)$/.test(department)) {
    throw new Error("Code département invalide.");
  }
  const source = officialDvfSource(input.year, department);
  const response = await request(
    source.url,
    { headers: { Accept: "application/gzip, application/octet-stream" } },
    120_000,
  );
  const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
  const expectedStreet = normalizeText(input.streetName);
  const expectedNumber = input.streetNumber.trim().replace(/^0+/, "");
  const tolerance = Math.max(0, input.valueTolerance ?? 0);
  const matches = csvObjects(text).filter((row) => {
    const number = (row.adresse_numero ?? "").trim().replace(/^0+/, "");
    const street = normalizeText(row.adresse_nom_voie ?? "");
    const value = numeric(row.valeur_fonciere);
    return (
      number === expectedNumber &&
      (street.includes(expectedStreet) || expectedStreet.includes(street)) &&
      (!input.postalCode || row.code_postal === input.postalCode) &&
      (!input.dateFrom || (row.date_mutation ?? "") >= input.dateFrom) &&
      (!input.dateTo || (row.date_mutation ?? "") <= input.dateTo) &&
      (input.targetValue === undefined ||
        (value !== undefined && Math.abs(value - input.targetValue) <= tolerance))
    );
  });
  const mutations = groupDvfRows(matches);
  const maxMutations = Math.min(200, Math.max(1, input.maxMutations ?? 50));
  return {
    query: input,
    source,
    rowsMatched: matches.length,
    mutationCount: mutations.length,
    mutations: mutations.slice(0, maxMutations),
    truncated: mutations.length > maxMutations,
    interpretation: {
      transactionAtAddress: mutations.length > 0 ? "established" : "not_found_in_queried_scope",
      buyerIdentity: "not_exposed_by_dvf",
      ownershipAttribution: "not_determinable_from_dvf_alone",
    },
    limitations: [
      "Les lignes sont regroupées par id_mutation : le prix répété sur plusieurs locaux ou lots ne doit jamais être additionné.",
      "DVF établit une mutation, une date, un prix et des caractéristiques cadastrales, mais ne publie pas l’identité de l’acquéreur ou du vendeur.",
      "Une correspondance exacte avec un mandat constitue une corroboration forte de son exécution, pas à elle seule une preuve de propriété de la personne ou structure visée.",
      "Ce connecteur suit la fenêtre publique des cinq dernières années complètes ; pour une mutation antérieure, interroger le MCP Parcellaire et recouper le résultat décisif.",
    ],
  };
}
