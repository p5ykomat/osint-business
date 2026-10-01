import {
  entrepriseSource,
  getCompanyBySiren,
  searchPersonMandates,
  type PublicCompany,
} from "../connectors/recherche-entreprises.js";
import { assertSiren, normalizeText } from "../lib/normalize.js";
import type { GraphEdge, GraphNode, RelationshipPath } from "../types.js";

export type RelatedEntityKind =
  | "sci"
  | "civil_company"
  | "commercial_or_other_company";

export interface LinkedEntitySummary {
  siren: string;
  name: string;
  legalFormCode?: string;
  administrativeState?: string;
  kind: RelatedEntityKind;
  person: string;
  rootRole: string;
  role?: string;
  confidence: "high" | "medium" | "low";
  matchBasis: string[];
  priority: "high" | "medium";
  interpretationLimits: string[];
  connectionToAnchor: RelationshipPath;
}

export interface PersonGraphCoverage {
  person: string;
  status: "complete_for_query" | "partial" | "unavailable";
  companiesReturned: number;
  companiesRetained?: number;
  companyLimit: number;
  retentionTruncated?: boolean;
  queryVariantsAttempted?: number;
  usualGivenNameRetry?: "not_needed" | "used" | "skipped_missing_birth";
  warnings?: string[];
  error?: string;
}

export interface GraphDependencies {
  getCompany: typeof getCompanyBySiren;
  searchMandates: typeof searchPersonMandates;
}

const defaultGraphDependencies: GraphDependencies = {
  getCompany: getCompanyBySiren,
  searchMandates: searchPersonMandates,
};

type MandateSearchResult = Awaited<ReturnType<typeof searchPersonMandates>>;

function usualGivenName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().split(/\s+/u).find(Boolean);
}

function mergeMandateSearchResults(results: MandateSearchResult[]): MandateSearchResult {
  const first = results[0];
  if (!first) throw new Error("Aucun résultat de recherche de mandats à fusionner.");

  const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
  const companies = new Map<string, MandateSearchResult["companies"][number]>();

  for (const result of results) {
    for (const companyResult of result.companies) {
      const existing = companies.get(companyResult.company.siren);
      if (!existing) {
        companies.set(companyResult.company.siren, {
          ...companyResult,
          matchingMandates: [...companyResult.matchingMandates],
          matchBasis: [...companyResult.matchBasis],
        });
        continue;
      }

      const mandates = new Map(
        existing.matchingMandates.map((mandate) => [
          [
            normalizeText(mandate.nom ?? ""),
            normalizeText(mandate.prenoms ?? ""),
            mandate.date_de_naissance ?? mandate.annee_de_naissance ?? "",
            normalizeText(mandate.qualite ?? ""),
          ].join("|"),
          mandate,
        ]),
      );
      for (const mandate of companyResult.matchingMandates) {
        const key = [
          normalizeText(mandate.nom ?? ""),
          normalizeText(mandate.prenoms ?? ""),
          mandate.date_de_naissance ?? mandate.annee_de_naissance ?? "",
          normalizeText(mandate.qualite ?? ""),
        ].join("|");
        mandates.set(key, mandate);
      }
      existing.matchingMandates = [...mandates.values()];
      existing.matchBasis = [...new Set([...existing.matchBasis, ...companyResult.matchBasis])];
      if (confidenceRank[companyResult.matchConfidence] > confidenceRank[existing.matchConfidence]) {
        existing.matchConfidence = companyResult.matchConfidence;
      }
    }
  }

  return {
    ...first,
    companies: [...companies.values()],
    limitations: [...new Set(results.flatMap((result) => result.limitations))],
  };
}

export function classifyRelatedEntity(company: PublicCompany): RelatedEntityKind {
  const legalFormCode = company.nature_juridique ?? "";
  const name = normalizeText(company.nom_complet ?? "");
  if (legalFormCode === "6540" || legalFormCode === "6544" || /^SCI(?: |$)/.test(name)) {
    return "sci";
  }
  if (legalFormCode.startsWith("65")) return "civil_company";
  return "commercial_or_other_company";
}

function companyNode(company: PublicCompany): GraphNode {
  return {
    id: `company:${company.siren}`,
    type: "company",
    label: company.nom_complet,
    properties: {
      siren: company.siren,
      legalFormCode: company.nature_juridique,
      entityKind: classifyRelatedEntity(company),
      activityCode: company.activite_principale,
      administrativeState: company.etat_administratif,
      headOffice: company.siege,
    },
  };
}

export async function buildCompanyMandateGraph(
  value: string,
  options: { maxPeople?: number; maxCompaniesPerPerson?: number } = {},
  dependencies: GraphDependencies = defaultGraphDependencies,
): Promise<{
  rootSiren: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  candidateEdges: GraphEdge[];
  source: ReturnType<typeof entrepriseSource>;
  linkedEntities: LinkedEntitySummary[];
  peopleCoverage: PersonGraphCoverage[];
  coverage: {
    peopleTotal: number;
    peopleExamined: number;
    peopleTruncated: boolean;
    maxCompaniesPerPerson: number;
  };
  limitations: string[];
}> {
  const siren = assertSiren(value);
  const root = await dependencies.getCompany(siren);
  const maxPeople = Math.min(25, Math.max(1, options.maxPeople ?? 10));
  const maxCompanies = Math.min(50, Math.max(1, options.maxCompaniesPerPerson ?? 20));
  const nodes = new Map<string, GraphNode>([[`company:${siren}`, companyNode(root)]]);
  const edges = new Map<string, GraphEdge>();
  const candidateEdges = new Map<string, GraphEdge>();
  const linkedEntities = new Map<string, LinkedEntitySummary>();
  const peopleCoverage: PersonGraphCoverage[] = [];
  const source = entrepriseSource();

  for (const representative of (root.dirigeants ?? []).filter(
    (director) => director.type_dirigeant === "personne morale" && director.siren,
  )) {
    const companyId = `company:${representative.siren}`;
    nodes.set(companyId, {
      id: companyId,
      type: "company",
      label: representative.denomination ?? representative.siren ?? "Personne morale",
      properties: { siren: representative.siren },
    });
    edges.set(`${companyId}|company:${siren}|${representative.qualite}`, {
      from: companyId,
      to: `company:${siren}`,
      relation: "corporate_representative",
      properties: { role: representative.qualite },
      evidence: {
        ...source,
        claim: `${representative.denomination ?? representative.siren} apparaît comme ${representative.qualite ?? "représentant"}.`,
        confidence: "high",
      },
    });
  }

  const allPeople = (root.dirigeants ?? []).filter(
    (director) => director.type_dirigeant === "personne physique" && director.nom,
  );
  const people = allPeople.slice(0, maxPeople);

  for (const [personIndex, person] of people.entries()) {
    const personLabel = [person.prenoms, person.nom].filter(Boolean).join(" ");
    // L'index distingue les homonymes dans la réponse sans publier leur date
    // ou année de naissance dans l'identifiant du nœud.
    const personId = `person:${normalizeText(person.nom ?? "")}|${normalizeText(person.prenoms ?? "")}|${personIndex + 1}`;
    nodes.set(personId, {
      id: personId,
      type: "person",
      label: personLabel,
      properties: {
        identityResolution: person.date_de_naissance
          ? "nom, prénoms et mois/année de naissance"
          : person.annee_de_naissance
            ? "nom, prénoms et année de naissance"
            : "nom et prénoms seulement",
      },
    });
    const rootRole = person.qualite ?? "dirigeant";
    edges.set(`${personId}|company:${siren}|${rootRole}`, {
      from: personId,
      to: `company:${siren}`,
      relation: "professional_mandate",
      properties: {
        role: rootRole,
        matchBasis: ["dirigeant publié dans la fiche officielle de la société racine"],
      },
      evidence: {
        ...source,
        claim: `${personLabel} apparaît avec le rôle « ${rootRole} » dans ${root.nom_complet}.`,
        confidence: "high",
        limitations: [
          "La fiche courante n’établit pas nécessairement la date initiale de prise de fonction.",
        ],
      },
    });

    const birthDisambiguator = person.date_de_naissance ?? person.annee_de_naissance;
    const firstName = usualGivenName(person.prenoms);
    const hasMultipleGivenNames =
      Boolean(firstName) && normalizeText(firstName ?? "") !== normalizeText(person.prenoms ?? "");
    const searchResults: MandateSearchResult[] = [];
    const searchErrors: string[] = [];
    let queryVariantsAttempted = 0;
    let usualGivenNameRetry: PersonGraphCoverage["usualGivenNameRetry"] = "not_needed";

    const runSearch = async (prenoms: string | undefined): Promise<void> => {
      queryVariantsAttempted += 1;
      try {
        searchResults.push(
          await dependencies.searchMandates({
            nom: person.nom ?? "",
            ...(prenoms ? { prenoms } : {}),
            ...(birthDisambiguator ? { dateNaissance: birthDisambiguator } : {}),
            maxResults: 100,
          }),
        );
      } catch (error) {
        searchErrors.push(error instanceof Error ? error.message : String(error));
      }
    };

    await runSearch(person.prenoms);

    // Les fiches racines publient souvent tous les prénoms tandis qu'une
    // société liée ne conserve que le prénom usuel. La variante est toujours
    // testée lorsqu'un identifiant de naissance interne permet de maîtriser le
    // risque d'homonymie, même si la première requête a trouvé un mandat.
    if (hasMultipleGivenNames) {
      if (birthDisambiguator && firstName) {
        usualGivenNameRetry = "used";
        await runSearch(firstName);
      } else {
        usualGivenNameRetry = "skipped_missing_birth";
      }
    }

    if (searchResults.length === 0) {
      peopleCoverage.push({
        person: personLabel,
        status: "unavailable",
        companiesReturned: 0,
        companyLimit: maxCompanies,
        queryVariantsAttempted,
        usualGivenNameRetry,
        error: searchErrors.join(" | ") || "Recherche de mandats indisponible.",
      });
      continue;
    }
    const mandates = mergeMandateSearchResults(searchResults);
    const coverageWarnings = [
      ...searchErrors.map((error) => `Une variante de recherche a échoué : ${error}`),
      ...(usualGivenNameRetry === "skipped_missing_birth"
        ? [
            "La variante au prénom usuel n'a pas été lancée faute de donnée de naissance permettant une désambiguïsation suffisante.",
          ]
        : []),
    ];
    const prioritizedCompanies = [...mandates.companies].sort((left, right) => {
      const entityPriority = { sci: 0, civil_company: 1, commercial_or_other_company: 2 } as const;
      return (
        entityPriority[classifyRelatedEntity(left.company)] -
          entityPriority[classifyRelatedEntity(right.company)] ||
        left.company.nom_complet.localeCompare(right.company.nom_complet)
      );
    });
    const retainedCompanies = prioritizedCompanies.slice(0, maxCompanies);
    const retentionTruncated = prioritizedCompanies.length > retainedCompanies.length;
    const sourceLimitReached = searchResults.some((result) => result.companies.length >= 100);
    peopleCoverage.push({
      person: personLabel,
      status:
        sourceLimitReached || retentionTruncated || coverageWarnings.length > 0
          ? "partial"
          : "complete_for_query",
      companiesReturned: mandates.companies.length,
      companiesRetained: retainedCompanies.length,
      companyLimit: maxCompanies,
      retentionTruncated,
      queryVariantsAttempted,
      usualGivenNameRetry,
      ...(coverageWarnings.length > 0 ? { warnings: coverageWarnings } : {}),
    });
    for (const result of retainedCompanies) {
      const companyId = `company:${result.company.siren}`;
      nodes.set(companyId, companyNode(result.company));
      for (const mandate of result.matchingMandates) {
        const edgeKey = `${personId}|${companyId}|${mandate.qualite ?? "mandate"}`;
        const graphEdge: GraphEdge = {
          from: personId,
          to: companyId,
          relation: "professional_mandate",
          properties: {
            role: mandate.qualite,
            matchBasis: result.matchBasis,
          },
          evidence: {
            ...mandates.source,
            claim: `${[mandate.prenoms, mandate.nom].filter(Boolean).join(" ")} apparaît avec le rôle « ${mandate.qualite ?? "non précisé"} » dans ${result.company.nom_complet}.`,
            confidence: result.matchConfidence,
            limitations: mandates.limitations,
          },
        };
        if (result.matchConfidence === "low") {
          candidateEdges.set(edgeKey, graphEdge);
          continue;
        }
        edges.set(edgeKey, graphEdge);
        if (result.company.siren !== siren) {
          const kind = classifyRelatedEntity(result.company);
          const linkedKey = `${personId}|${result.company.siren}|${mandate.qualite ?? "mandate"}`;
          const linkedRole = mandate.qualite ?? "rôle public non précisé";
          const relationshipConfidence = result.matchConfidence === "high" ? "high" : "medium";
          const relationshipStatus = result.matchConfidence === "high" ? "verified" : "corroborated";
          const relationshipLimitations = [
            "Le mandat ou la qualité déclarée n’établit pas un pourcentage de détention.",
            "Aucun lien opérationnel avec la société racine n’est déduit sans preuve distincte.",
            "Aucune relation familiale ou patrimoniale n’est inférée de ce seul lien.",
          ];
          linkedEntities.set(linkedKey, {
            siren: result.company.siren,
            name: result.company.nom_complet,
            ...(result.company.nature_juridique
              ? { legalFormCode: result.company.nature_juridique }
              : {}),
            ...(result.company.etat_administratif
              ? { administrativeState: result.company.etat_administratif }
              : {}),
            kind,
            person: personLabel,
            rootRole,
            ...(mandate.qualite ? { role: mandate.qualite } : {}),
            confidence: result.matchConfidence,
            matchBasis: result.matchBasis,
            priority: kind === "sci" || kind === "civil_company" ? "high" : "medium",
            interpretationLimits: relationshipLimitations,
            connectionToAnchor: {
              id: `auto:${siren}:${personId}:${result.company.siren}`,
              anchor: {
                id: `company:${siren}`,
                type: "company",
                label: root.nom_complet,
                siren,
              },
              target: {
                id: companyId,
                type: "company",
                label: result.company.nom_complet,
                siren: result.company.siren,
              },
              priority: kind === "sci" || kind === "civil_company" ? "high" : "medium",
              analyticalRelevance: `${result.company.nom_complet} est rattachée à ${root.nom_complet} par la même personne publiée dans les deux structures.`,
              steps: [
                {
                  from: {
                    id: `company:${siren}`,
                    type: "company",
                    label: root.nom_complet,
                    siren,
                  },
                  to: { id: personId, type: "person", label: personLabel },
                  relation: "professional_mandate",
                  exactMechanism: `${personLabel} apparaît avec le rôle « ${rootRole} » dans la société pivot ${root.nom_complet}.`,
                  verificationStatus: "verified",
                  temporalStatus: "current",
                  confidence: "high",
                  effectiveAt: null,
                  endedAt: null,
                  evidence: [
                    {
                      level: "official_metadata",
                      source: source.name,
                      page: null,
                      date: source.retrievedAt,
                      reference: source.url,
                    },
                  ],
                  limitations: [
                    "La fiche courante n’établit pas nécessairement la date initiale de prise de fonction.",
                  ],
                },
                {
                  from: { id: personId, type: "person", label: personLabel },
                  to: {
                    id: companyId,
                    type: "company",
                    label: result.company.nom_complet,
                    siren: result.company.siren,
                  },
                  relation: "professional_mandate",
                  exactMechanism: `${personLabel} apparaît avec le rôle « ${linkedRole} » dans ${result.company.nom_complet}.`,
                  verificationStatus: relationshipStatus,
                  temporalStatus: "current",
                  confidence: relationshipConfidence,
                  effectiveAt: null,
                  endedAt: null,
                  evidence: [
                    {
                      level: "official_metadata",
                      source: mandates.source.name,
                      page: null,
                      date: mandates.source.retrievedAt,
                      reference: mandates.source.url,
                    },
                  ],
                  limitations: mandates.limitations,
                },
              ],
              whatItDoesNotProve: relationshipLimitations,
              source: "automated_mandate_graph",
              status: relationshipStatus,
              confidence: relationshipConfidence,
              hopCount: 2,
              summary: `${root.nom_complet} ←[${rootRole}]  ${personLabel} [${linkedRole}]→ ${result.company.nom_complet}`,
              validationErrors: [],
            },
          });
        }
      }
    }
  }

  return {
    rootSiren: siren,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    candidateEdges: [...candidateEdges.values()],
    source,
    linkedEntities: [...linkedEntities.values()].sort((left, right) => {
      const priority = { high: 0, medium: 1 } as const;
      return priority[left.priority] - priority[right.priority] || left.name.localeCompare(right.name);
    }),
    peopleCoverage,
    coverage: {
      peopleTotal: allPeople.length,
      peopleExamined: people.length,
      peopleTruncated: allPeople.length > people.length,
      maxCompaniesPerPerson: maxCompanies,
    },
    limitations: [
      "Le graphe représente des mandats et rôles publics, pas nécessairement des participations capitalistiques.",
      "L’absence de lien ne prouve pas l’absence de relation ; certaines données sont non diffusables ou historiques.",
      "L’objet social d’une SCI décrit un objet déclaré et ne prouve pas l’usage réel de la structure.",
      "Une adresse commune ou un homonyme ne doit jamais être transformé seul en lien certain.",
      "Les rapprochements à faible confiance sont placés dans candidateEdges et exclus du graphe vérifié.",
      ...(allPeople.length > people.length
        ? [`La recherche a été limitée à ${people.length} personnes sur ${allPeople.length}.`]
        : []),
    ],
  };
}
