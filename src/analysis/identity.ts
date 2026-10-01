import {
  entrepriseSource,
  searchCompanies,
  type PublicCompany,
} from "../connectors/recherche-entreprises.js";
import { normalizeText } from "../lib/normalize.js";

export interface CompanyIdentityContext {
  commune?: string;
  postalCode?: string;
  address?: string;
  activityCode?: string;
  directorName?: string;
}

export interface ScoredCompanyCandidate {
  company: PublicCompany;
  score: number;
  reasons: string[];
  contradictions: string[];
}

function stringField(object: Record<string, unknown> | undefined, key: string): string {
  const value = object?.[key];
  return typeof value === "string" ? value : "";
}

export function scoreCompanyCandidate(
  query: string,
  context: CompanyIdentityContext,
  company: PublicCompany,
): ScoredCompanyCandidate {
  const normalizedQuery = normalizeText(query);
  const digits = query.replace(/\D/g, "");
  const reasons: string[] = [];
  const contradictions: string[] = [];
  let score = 0;

  if (digits.length === 9 && company.siren === digits) {
    score += 100;
    reasons.push("SIREN exact");
  } else if (
    digits.length === 14 &&
    company.siren === digits.slice(0, 9) &&
    stringField(company.siege, "siret") === digits
  ) {
    score += 100;
    reasons.push("SIRET exact");
  }

  const names = [company.nom_complet, company.nom_raison_sociale, company.sigle]
    .filter((value): value is string => Boolean(value))
    .map(normalizeText);
  if (names.includes(normalizedQuery)) {
    score += normalizedQuery.length <= 4 ? 40 : 60;
    reasons.push("dénomination ou sigle exact");
  } else if (names.some((name) => name.includes(normalizedQuery))) {
    score += 20;
    reasons.push("dénomination contenant la requête");
  }

  if (company.etat_administratif === "A") {
    score += 5;
    reasons.push("entité active");
  }

  const seatCommune = normalizeText(
    stringField(company.siege, "libelle_commune") || stringField(company.siege, "commune"),
  );
  if (context.commune) {
    if (seatCommune.includes(normalizeText(context.commune))) {
      score += 20;
      reasons.push("commune concordante");
    } else {
      score -= 15;
      contradictions.push("commune contradictoire");
    }
  }

  const seatPostalCode = stringField(company.siege, "code_postal");
  if (context.postalCode) {
    if (seatPostalCode === context.postalCode) {
      score += 20;
      reasons.push("code postal concordant");
    } else {
      score -= 15;
      contradictions.push("code postal contradictoire");
    }
  }

  const seatAddress = normalizeText(
    stringField(company.siege, "adresse") ||
      [
        stringField(company.siege, "numero_voie"),
        stringField(company.siege, "type_voie"),
        stringField(company.siege, "libelle_voie"),
      ].filter(Boolean).join(" "),
  );
  if (context.address) {
    const expectedAddress = normalizeText(context.address);
    if (seatAddress.includes(expectedAddress) || expectedAddress.includes(seatAddress)) {
      score += 25;
      reasons.push("adresse professionnelle concordante");
    } else {
      score -= 10;
      contradictions.push("adresse professionnelle contradictoire");
    }
  }

  if (context.activityCode) {
    if (normalizeText(company.activite_principale ?? "") === normalizeText(context.activityCode)) {
      score += 15;
      reasons.push("activité principale concordante");
    } else {
      score -= 5;
      contradictions.push("activité principale contradictoire");
    }
  }

  if (context.directorName) {
    const expectedDirector = normalizeText(context.directorName);
    const directorMatch = (company.dirigeants ?? []).some((director) =>
      normalizeText([director.prenoms, director.nom, director.denomination].filter(Boolean).join(" "))
        .includes(expectedDirector),
    );
    if (directorMatch) {
      score += 25;
      reasons.push("dirigeant concordant");
    } else {
      score -= 10;
      contradictions.push("dirigeant non retrouvé dans la fiche courante");
    }
  }

  return { company, score, reasons, contradictions };
}

export async function resolveCompanyIdentity(
  query: string,
  context: CompanyIdentityContext = {},
  limit = 10,
  search: typeof searchCompanies = searchCompanies,
): Promise<{
  status: "resolved" | "ambiguous" | "not_found";
  selected?: ScoredCompanyCandidate;
  candidates: ScoredCompanyCandidate[];
  decision: string;
  source: ReturnType<typeof entrepriseSource>;
}> {
  const response = await search(query, 1, Math.min(25, Math.max(1, limit)));
  const candidates = response.results
    .map((company) => scoreCompanyCandidate(query, context, company))
    .sort((left, right) => right.score - left.score || left.company.siren.localeCompare(right.company.siren));
  const first = candidates[0];
  const second = candidates[1];
  if (!first) {
    return {
      status: "not_found",
      candidates: [],
      decision: "Aucun candidat diffusable n’a été trouvé.",
      source: entrepriseSource(),
    };
  }

  const exactIdentifier = first.reasons.includes("SIREN exact") || first.reasons.includes("SIRET exact");
  const margin = first.score - (second?.score ?? 0);
  const enoughContext = Object.values(context).some(Boolean);
  const resolved = exactIdentifier || (first.score >= 65 && margin >= 15) || (enoughContext && first.score >= 55 && margin >= 20);
  if (!resolved) {
    return {
      status: "ambiguous",
      candidates,
      decision: `Le meilleur candidat n’est pas assez distinct du suivant (score ${first.score}, marge ${margin}). Ajouter commune, adresse, activité ou dirigeant.`,
      source: entrepriseSource(),
    };
  }
  return {
    status: "resolved",
    selected: first,
    candidates,
    decision: exactIdentifier
      ? "Identité verrouillée par identifiant exact."
      : `Identité résolue par concordance multicritère (score ${first.score}, marge ${margin}).`,
    source: entrepriseSource(),
  };
}
