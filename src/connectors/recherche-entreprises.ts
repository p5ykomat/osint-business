import { getJson } from "../lib/http.js";
import {
  assertSiren,
  givenNamesMatch,
  normalizeText,
} from "../lib/normalize.js";
import type { SourceRef } from "../types.js";

const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";

export interface PublicDirector {
  nom?: string;
  prenoms?: string;
  annee_de_naissance?: string;
  date_de_naissance?: string;
  qualite?: string;
  nationalite?: string | null;
  type_dirigeant?: string;
  siren?: string;
  denomination?: string;
}

export interface PublicCompany {
  siren: string;
  nom_complet: string;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  nombre_etablissements?: number;
  nombre_etablissements_ouverts?: number;
  siege?: Record<string, unknown>;
  activite_principale?: string;
  categorie_entreprise?: string | null;
  annee_categorie_entreprise?: string | null;
  date_creation?: string;
  date_fermeture?: string | null;
  date_mise_a_jour?: string;
  date_mise_a_jour_insee?: string;
  date_mise_a_jour_rne?: string;
  dirigeants?: PublicDirector[];
  etat_administratif?: string;
  nature_juridique?: string;
  tranche_effectif_salarie?: string | null;
  annee_tranche_effectif_salarie?: string | null;
  finances?: Record<string, { ca?: number; resultat_net?: number }> | null;
  complements?: Record<string, unknown>;
  tva?: string[];
}

interface SearchResponse {
  results: PublicCompany[];
  total_results: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export function entrepriseSource(): SourceRef {
  return {
    name: "API Recherche d’Entreprises",
    publisher: "DINUM / Annuaire des Entreprises",
    url: "https://recherche-entreprises.api.gouv.fr/docs/",
    retrievedAt: new Date().toISOString(),
    status: "primary",
  };
}

export async function searchCompanies(
  query: string,
  page = 1,
  perPage = 10,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    page: String(Math.max(1, page)),
    per_page: String(Math.min(25, Math.max(1, perPage))),
  });
  return getJson<SearchResponse>(`${API_BASE}?${params.toString()}`);
}

export async function getCompanyBySiren(value: string): Promise<PublicCompany> {
  const siren = assertSiren(value);
  const response = await searchCompanies(siren, 1, 10);
  const company = response.results.find((candidate) => candidate.siren === siren);
  if (!company) throw new Error(`Aucune entreprise diffusable trouvée pour le SIREN ${siren}.`);
  return company;
}

export interface PersonMandateSearch {
  nom: string;
  prenoms?: string;
  dateNaissance?: string;
  maxResults?: number;
}

export interface PersonMatchAssessment {
  matches: boolean;
  confidence: "high" | "medium" | "low";
  basis: string[];
}

export function assessPersonMatch(
  input: Pick<PersonMandateSearch, "nom" | "prenoms" | "dateNaissance">,
  director: PublicDirector,
): PersonMatchAssessment {
  const expectedBirthMonth = /^\d{4}-\d{2}$/.test(input.dateNaissance ?? "")
    ? input.dateNaissance
    : undefined;
  const expectedYear = /^\d{4}(?:-\d{2})?$/.test(input.dateNaissance ?? "")
    ? input.dateNaissance?.slice(0, 4)
    : undefined;
  const basis = ["nom normalisé identique"];
  if (input.prenoms) basis.push("prénoms compatibles");
  if (expectedBirthMonth) basis.push("mois et année de naissance identiques");
  else if (expectedYear) basis.push("année de naissance identique");

  const confidence: PersonMatchAssessment["confidence"] = expectedBirthMonth
    ? "high"
    : input.prenoms || expectedYear
      ? "medium"
      : "low";
  const directorYear = director.annee_de_naissance ?? director.date_de_naissance?.slice(0, 4);
  const matches =
    director.type_dirigeant === "personne physique" &&
    normalizeText(director.nom ?? "") === normalizeText(input.nom) &&
    (!input.prenoms || givenNamesMatch(input.prenoms, director.prenoms ?? "")) &&
    (!expectedBirthMonth || director.date_de_naissance === expectedBirthMonth) &&
    (expectedBirthMonth !== undefined || expectedYear === undefined || directorYear === expectedYear);

  return { matches, confidence, basis };
}

export async function searchPersonMandates(input: PersonMandateSearch): Promise<{
  person: PersonMandateSearch;
  companies: Array<{
    company: PublicCompany;
    matchingMandates: PublicDirector[];
    matchConfidence: "high" | "medium" | "low";
    matchBasis: string[];
  }>;
  source: SourceRef;
  limitations: string[];
}> {
  const query = [input.prenoms, input.nom].filter(Boolean).join(" ");
  const maxResults = Math.min(100, Math.max(1, input.maxResults ?? 100));
  const collected: PublicCompany[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await searchCompanies(query, page, 25);
    collected.push(...response.results);
    totalPages = response.total_pages;
    page += 1;
  } while (page <= totalPages && collected.length < maxResults);

  const companies = collected
    .slice(0, maxResults)
    .map((company) => {
      const matchingMandates = (company.dirigeants ?? []).filter(
        (director) => assessPersonMatch(input, director).matches,
      );
      const assessment = assessPersonMatch(input, matchingMandates[0] ?? {});

      return {
        company,
        matchingMandates,
        matchConfidence: assessment.confidence,
        matchBasis: assessment.basis,
      };
    })
    .filter((result) => result.matchingMandates.length > 0);

  return {
    person: input,
    companies,
    source: entrepriseSource(),
    limitations: [
      "Un homonyme reste possible sans date de naissance ou autre identifiant concordant.",
      "La recherche porte sur les mandats publics présents dans les données diffusables, pas sur l’intégralité de la vie professionnelle.",
      "La date de naissance est volontairement limitée au mois et à l’année lorsqu’elle est publiée.",
    ],
  };
}
