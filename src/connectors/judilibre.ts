import { requestJson } from "../lib/http.js";
import type { SourceRef } from "../types.js";

const OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const API_BASE = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";

interface OAuthResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | undefined;

function requiredEnvironment(name: "PISTE_CLIENT_ID" | "PISTE_CLIENT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} absent. Complétez votre fichier .env personnel selon docs/ACCES.md, puis reconnectez le serveur MCP.`,
    );
  }
  return value;
}

async function pisteToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: requiredEnvironment("PISTE_CLIENT_ID"),
    client_secret: requiredEnvironment("PISTE_CLIENT_SECRET"),
    scope: "openid",
  });
  const response = await requestJson<OAuthResponse>(
    OAUTH_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    30_000,
  );
  if (!response.access_token) throw new Error("PISTE n’a pas renvoyé de jeton OAuth.");

  const expiresIn = Math.max(60, response.expires_in ?? 3600);
  tokenCache = {
    token: response.access_token,
    expiresAt: Date.now() + expiresIn * 1000 - 60_000,
  };
  return response.access_token;
}

async function judilibreGet<T>(path: string, params?: URLSearchParams): Promise<T> {
  const token = await pisteToken();
  const suffix = params && params.size > 0 ? `?${params.toString()}` : "";
  return requestJson<T>(`${API_BASE}${path}${suffix}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
}

export function judilibreSource(): SourceRef {
  return {
    name: "API Judilibre",
    publisher: "Cour de cassation / PISTE",
    url: "https://www.courdecassation.fr/acces-rapide-judilibre/donnees-ouvertes-open-data-et-api",
    retrievedAt: new Date().toISOString(),
    status: "primary",
  };
}

export interface JudilibreSearchInput {
  query: string;
  dateStart?: string;
  dateEnd?: string;
  jurisdictions?: string[];
  fields?: string[];
  types?: string[];
  page?: number;
  pageSize?: number;
  sort?: "score" | "date";
  order?: "asc" | "desc";
}

function appendMany(params: URLSearchParams, name: string, values?: string[]): void {
  for (const value of values ?? []) params.append(name, value);
}

export async function searchJudilibre(input: JudilibreSearchInput): Promise<{
  query: JudilibreSearchInput;
  results: unknown;
  source: SourceRef;
  limitations: string[];
}> {
  const params = new URLSearchParams({
    query: input.query,
    page: String(Math.max(0, input.page ?? 0)),
    page_size: String(Math.min(50, Math.max(1, input.pageSize ?? 10))),
    sort: input.sort ?? "score",
    order: input.order ?? "desc",
  });
  if (input.dateStart) params.set("date_start", input.dateStart);
  if (input.dateEnd) params.set("date_end", input.dateEnd);
  appendMany(params, "jurisdiction", input.jurisdictions);
  appendMany(params, "field", input.fields);
  appendMany(params, "type", input.types);

  return {
    query: input,
    results: await judilibreGet<unknown>("/search", params),
    source: judilibreSource(),
    limitations: [
      "Les personnes physiques sont pseudonymisées dans les décisions diffusées.",
      "Une décision peut citer une entreprise comme partie, conseil, tiers ou simple élément de contexte.",
      "Une absence de résultat n’établit aucune absence d’antécédent ou de contentieux.",
      "La couverture de l’open data judiciaire est progressive et ne correspond pas à un casier judiciaire.",
    ],
  };
}

export async function getJudilibreDecision(value: string): Promise<{
  decisionId: string;
  decision: unknown;
  source: SourceRef;
  limitations: string[];
}> {
  const decisionId = value.trim();
  if (!decisionId || decisionId.length > 300) throw new Error("Identifiant Judilibre invalide.");
  const params = new URLSearchParams({ id: decisionId, resolve_references: "true" });
  return {
    decisionId,
    decision: await judilibreGet<unknown>("/decision", params),
    source: judilibreSource(),
    limitations: [
      "Le texte est diffusé après occultation et pseudonymisation selon les règles de l’open data judiciaire.",
      "Vérifier la date, la juridiction, le rôle de l’entité citée, la solution et les éventuelles voies de recours.",
    ],
  };
}
