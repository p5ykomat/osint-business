import { buildCompanyMandateGraph } from "./graph.js";
import {
  buildEconomicFootprint,
  type EconomicFootprintOptions,
} from "./economic-footprint.js";
import {
  buildRelationalSynthesis,
  endpointMatches,
  type RelationalSynthesis,
} from "./relationships.js";
import { reconcileObservations, type FactObservation } from "./reconcile.js";
import {
  routeRegulatoryChecks,
  type RegulatoryRoutingResult,
} from "./regulatory-router.js";
import { searchAdlcSanctions } from "../connectors/adlc.js";
import { getBodaccHistory } from "../connectors/bodacc.js";
import { getInpiAttachments, getInpiCompany } from "../connectors/inpi.js";
import {
  entrepriseSource,
  getCompanyBySiren,
  type PublicCompany,
  type PublicDirector,
} from "../connectors/recherche-entreprises.js";
import { assertSiren, normalizeText } from "../lib/normalize.js";
import type {
  CoverageCheck,
  DocumentaryRelationshipPathInput,
  DocumentaryFindingInput,
  ExplorationOption,
  InvestigationLead,
  MaterialFinding,
  QualityGate,
  RelationshipEndpoint,
  SourceRef,
} from "../types.js";

type BodaccResult = Awaited<ReturnType<typeof getBodaccHistory>>;
type GraphResult = Awaited<ReturnType<typeof buildCompanyMandateGraph>>;
type InpiRecordResult = Awaited<ReturnType<typeof getInpiCompany>>;
type InpiAttachmentsResult = Awaited<ReturnType<typeof getInpiAttachments>>;
type AdlcResult = Awaited<ReturnType<typeof searchAdlcSanctions>>;

type SourceOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface CompanyReportOptions {
  maxPeople?: number;
  maxCompaniesPerPerson?: number;
  externalObservations?: FactObservation[];
  documentaryFindings?: DocumentaryFindingInput[];
  documentaryRelationshipPaths?: DocumentaryRelationshipPathInput[];
  economicFootprint?: EconomicFootprintOptions;
}

export interface CompanyReportDependencies {
  getCompany: typeof getCompanyBySiren;
  buildGraph: typeof buildCompanyMandateGraph;
  getBodacc: typeof getBodaccHistory;
  getInpiRecord: typeof getInpiCompany;
  getInpiAttachments: typeof getInpiAttachments;
  searchAdlc: typeof searchAdlcSanctions;
}

const defaultDependencies: CompanyReportDependencies = {
  getCompany: getCompanyBySiren,
  buildGraph: buildCompanyMandateGraph,
  getBodacc: getBodaccHistory,
  getInpiRecord: getInpiCompany,
  getInpiAttachments,
  searchAdlc: searchAdlcSanctions,
};

async function capture<T>(operation: () => Promise<T>): Promise<SourceOutcome<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function arrayCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => Array.isArray(child))
      .map(([key, child]) => [key, (child as unknown[]).length]),
  );
}

function extractSirens(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap(extractSirens))];
  if (value && typeof value === "object") {
    return [...new Set(Object.values(value as Record<string, unknown>).flatMap(extractSirens))];
  }
  if (typeof value !== "string" && typeof value !== "number") return [];
  const candidate = String(value).replace(/\D/g, "");
  return /^\d{9}$/.test(candidate) ? [candidate] : [];
}

function materialFindingId(prefix: string, title: string, index: number): string {
  const slug = normalizeText(title).toLowerCase().replace(/\s+/g, "-").slice(0, 72);
  return `${prefix}:${slug || "finding"}:${index + 1}`;
}

function normalizeDocumentaryFindings(
  inputs: DocumentaryFindingInput[],
): MaterialFinding[] {
  return inputs.map((input, index) => ({
    id: input.id ?? materialFindingId("document", input.title, index),
    title: input.title,
    category: input.category,
    priority: input.priority,
    establishedFact: input.establishedFact,
    whyItMatters: input.whyItMatters,
    evidence: input.evidence.map((evidence) => ({ ...evidence })),
    whatItDoesNotProve: [...input.whatItDoesNotProve],
    nextVerification: [...input.nextVerification],
    ...(input.subject ? { subject: { ...input.subject } } : {}),
    ...(input.relationshipPathIds
      ? { relationshipPathIds: [...input.relationshipPathIds] }
      : {}),
    origin: input.evidence.some((evidence) => evidence.level === "primary_document")
      ? "document_reading"
      : "provided_observation",
  }));
}

function observationFact(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["establishedFact", "established_fact", "statement", "fact", "description"]) {
      if (typeof record[key] === "string") return record[key];
    }
  }
  return JSON.stringify(value);
}

function observationPage(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = (value as Record<string, unknown>).page;
  return typeof page === "string" || typeof page === "number" ? String(page) : null;
}

function structuralObservationFinding(
  observation: FactObservation,
  index: number,
): MaterialFinding {
  return {
    id: materialFindingId("structure", "Concentration initiale documentée", index),
    title: "Concentration initiale documentée",
    category: "ownership",
    priority: "medium",
    establishedFact: observationFact(observation.value),
    whyItMatters:
      "La répartition initiale éclaire la constitution de la structure et fournit un point de comparaison pour les cessions ou augmentations de capital ultérieures.",
    evidence: [
      {
        level: "external_observation",
        source: observation.source,
        page: observationPage(observation.value),
        date: observation.effectiveAt ?? observation.observedAt ?? null,
      },
    ],
    whatItDoesNotProve: [
      "Cette répartition initiale ne prouve pas la détention actuelle.",
      "Elle ne suffit pas à établir les bénéficiaires effectifs actuels ni la valeur économique des parts.",
    ],
    nextVerification: [
      "Comparer avec les derniers statuts disponibles et les actes de cession ou de modification du capital.",
    ],
    origin: "structural_deduction",
  };
}

function coverageFromBodacc(
  id: string,
  purpose: string,
  outcome: SourceOutcome<BodaccResult>,
  queriedAt: string,
): CoverageCheck {
  if (!outcome.ok) {
    return {
      id,
      source: "BODACC",
      purpose,
      status: "failed",
      queriedAt,
      reason: outcome.error,
      supportsNegativeConclusion: false,
    };
  }
  return {
    id,
    source: "BODACC",
    purpose,
    status: outcome.value.total > outcome.value.returned ? "partial" : "complete",
    queriedAt,
    returned: outcome.value.returned,
    total: outcome.value.total,
    limitations: [outcome.value.coverage],
    supportsNegativeConclusion: outcome.value.total === outcome.value.returned,
  };
}

function sourceCoverage(
  id: string,
  source: string,
  purpose: string,
  outcome: SourceOutcome<unknown>,
  queriedAt: string,
  limitations: string[] = [],
): CoverageCheck {
  if (!outcome.ok) {
    return {
      id,
      source,
      purpose,
      status: "failed",
      queriedAt,
      reason: outcome.error,
      supportsNegativeConclusion: false,
    };
  }
  return {
    id,
    source,
    purpose,
    status: "complete",
    queriedAt,
    limitations,
    supportsNegativeConclusion: true,
  };
}

function financialAvailability(
  company: PublicCompany,
  accounts: SourceOutcome<BodaccResult>,
): {
  status:
    | "available"
    | "confidential"
    | "deposited_unreadable"
    | "not_found_in_consulted_sources"
    | "source_failed";
  publicExerciseCount: number;
  explanation: string;
} {
  const publicExerciseCount = Object.keys(company.finances ?? {}).length;
  if (publicExerciseCount > 0) {
    return {
      status: "available",
      publicExerciseCount,
      explanation: `${publicExerciseCount} exercice(s) financier(s) synthétique(s) sont disponibles.`,
    };
  }
  if (!accounts.ok) {
    return {
      status: "source_failed",
      publicExerciseCount: 0,
      explanation: "La disponibilité financière ne peut pas être qualifiée car le contrôle des dépôts a échoué.",
    };
  }
  if (accounts.value.total > 0) {
    const body = JSON.stringify(accounts.value.records);
    const confidential = /confidential/i.test(body);
    return {
      status: confidential ? "confidential" : "deposited_unreadable",
      publicExerciseCount: 0,
      explanation: confidential
        ? "Au moins un dépôt de comptes est publié avec une mention de confidentialité ; les chiffres ne sont pas accessibles dans les sources interrogées."
        : "Au moins un dépôt de comptes est publié, mais aucun exercice chiffré exploitable n’a été récupéré.",
    };
  }
  return {
    status: "not_found_in_consulted_sources",
    publicExerciseCount: 0,
    explanation: "Aucun chiffre ni dépôt de comptes n’a été trouvé dans les endpoints interrogés ; cela ne prouve pas une absence de dépôt historique.",
  };
}

function uniqueAliases(company: PublicCompany): string[] {
  return [...new Set([company.nom_complet, company.nom_raison_sociale, company.sigle]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim()))];
}

function publicRepresentativeSummary(director: PublicDirector): Record<string, unknown> {
  return {
    type: director.type_dirigeant,
    role: director.qualite,
    ...(director.type_dirigeant === "personne physique"
      ? {
          name: director.nom,
          givenNames: director.prenoms,
          identityResolutionDataUsed: director.date_de_naissance
            ? "mois/année de naissance utilisés en interne, non restitués"
            : director.annee_de_naissance
              ? "année de naissance utilisée en interne, non restituée"
              : "nom et prénoms seulement",
        }
      : {
          siren: director.siren,
          denomination: director.denomination,
        }),
  };
}

function buildExplorationMenu(
  company: PublicCompany,
  graph: SourceOutcome<GraphResult>,
  finances: ReturnType<typeof financialAvailability>,
  attachmentCounts: Record<string, number>,
  relationships: RelationalSynthesis,
  regulatoryRouting: RegulatoryRoutingResult,
): ExplorationOption[] {
  const options: ExplorationOption[] = [];
  if (graph.ok) {
    for (const entity of graph.value.linkedEntities) {
      options.push({
        id: `explore-linked:${entity.siren}`,
        priority: entity.priority,
        title: `Approfondir ${entity.name} (${entity.siren})`,
        whyNow: `Chemin au pivot : ${entity.connectionToAnchor.summary}. ${entity.kind === "sci" ? "La structure cible est une SCI." : "Il s’agit d’une entité connexe."}`,
        scope: [
          "validation de chaque maillon du chemin au pivot",
          "identité et chronologie RNE/BODACC",
          "dirigeants, associés déclarés et autres ramifications publiques",
          "actes, statuts et comptes accessibles",
          "liens démontrables avec la société racine",
        ],
        expectedOutputs: [
          "graphe propre à l’entité",
          "rôles publics et dates disponibles",
          "hypothèses patrimoniales clairement séparées des faits",
        ],
        limitations: entity.interpretationLimits,
        requiresAdditionalAuthorization: false,
        launchPrompt: `En partant du pivot ${company.nom_complet}, SIREN ${company.siren}, approfondis ${entity.name}, SIREN ${entity.siren}, et conserve pour chaque fait le chemin relationnel ${entity.connectionToAnchor.summary}.`,
        anchorPathId: entity.connectionToAnchor.id,
        triggeringGap: `Le lien public est établi, mais les effets patrimoniaux, capitalistiques ou opérationnels ne le sont pas automatiquement.`,
      });
    }
  }
  const automaticPathIds = new Set(
    graph.ok
      ? graph.value.linkedEntities.map((entity) => entity.connectionToAnchor.id)
      : [],
  );
  for (const path of relationships.primaryPaths.filter(
    (candidate) => !automaticPathIds.has(candidate.id),
  )) {
    options.push({
      id: `explore-path:${path.id}`,
      priority: path.priority,
      title: `Approfondir le lien avec ${path.target.label}`,
      whyNow: `Chemin au pivot : ${path.summary}. ${path.analyticalRelevance}`,
      scope: [
        "vérification de la continuité et de la date de chaque maillon",
        "actes, statuts et sources primaires disponibles",
        "effets patrimoniaux, professionnels ou juridiques réellement démontrables",
      ],
      expectedOutputs: [
        "chemin de preuve consolidé",
        "faits nouveaux rattachés au pivot",
        "limites et hypothèses séparées",
      ],
      limitations: path.whatItDoesNotProve,
      requiresAdditionalAuthorization: false,
      launchPrompt: `En partant du pivot ${company.nom_complet}, SIREN ${company.siren}, approfondis le chemin vers ${path.target.label} : ${path.summary}. Reste sur des sources gratuites et rattache chaque nouveau fait au pivot.`,
      anchorPathId: path.id,
      triggeringGap: path.analyticalRelevance,
    });
  }
  if ((attachmentCounts.actes ?? 0) > 0) {
    options.push({
      id: `explore-documents:${company.siren}`,
      priority: "high",
      title: "Lire et chronologiser les actes disponibles",
      whyNow: `${attachmentCounts.actes} acte(s) sont inventoriés mais leurs effets juridiques ne sont pas tous extraits automatiquement.`,
      scope: ["statuts", "mouvements de capital", "nominations et démissions", "cessions de parts"],
      expectedOutputs: ["chronologie pièce par pièce", "associés nommés dans les pièces accessibles", "contradictions résolues par date d’effet"],
      limitations: ["Le texte de certaines pièces peut être indisponible, non OCRisé ou expurgé."],
      requiresAdditionalAuthorization: false,
      launchPrompt: `Approfondis les actes et statuts de ${company.nom_complet}, SIREN ${company.siren}.`,
    });
  }
  if (finances.status !== "available") {
    options.push({
      id: `explore-finance:${company.siren}`,
      priority: finances.status === "confidential" ? "medium" : "high",
      title: "Approfondir la capacité financière avec des indicateurs indirects",
      whyNow: finances.explanation,
      scope: ["dépôts et événements BODACC", "effectifs datés", "marchés publics", "signaux d’activité publiquement démontrables"],
      expectedOutputs: ["indicateurs disponibles et datés", "limites explicites", "liste des documents à demander au tiers"],
      limitations: ["Aucun indicateur indirect ne remplace des comptes complets ni une cotation Banque de France."],
      requiresAdditionalAuthorization: false,
      launchPrompt: `Approfondis la situation financière publique de ${company.nom_complet}, SIREN ${company.siren}, sans inférer la solvabilité à partir du capital.`,
    });
  }
  if (regulatoryRouting.selectedRoutes.length > 0) {
    const routeIds = regulatoryRouting.selectedRoutes.map((route) => route.id);
    const routeTitles = regulatoryRouting.selectedRoutes.map((route) => route.title);
    options.push({
      id: `explore-regulatory:${company.siren}`,
      priority: regulatoryRouting.selectedRoutes.some((route) => route.priority === "high")
        ? "high"
        : "medium",
      title: "Exécuter les contrôles réglementaires routés",
      whyNow: `${regulatoryRouting.selectedRoutes.length} route(s) officielle(s) et gratuite(s) ont été sélectionnée(s) pour le code NAF ${company.activite_principale ?? "non renseigné"}, sans être encore présentées comme exécutées.`,
      scope: routeTitles,
      expectedOutputs: [
        "requêtes et variantes réellement utilisées",
        "résultats attribués par identifiants et dates",
        "état des décisions, autorisations ou recours",
      ],
      limitations: [
        regulatoryRouting.warning,
        ...regulatoryRouting.selectedRoutes.flatMap((route) => route.limitations).slice(0, 8),
      ],
      requiresAdditionalAuthorization: false,
      launchPrompt: `Exécute les contrôles réglementaires gratuits routés pour ${company.nom_complet}, SIREN ${company.siren} : ${routeIds.join(", ")}. Interroge réellement chaque source officielle, désambiguïse les correspondances et conserve les limites de couverture.`,
      triggeringGap: "Les sources sont sélectionnées, mais aucun résultat réglementaire n’est revendiqué avant leur interrogation effective.",
    });
  }
  options.push(
    {
      id: `explore-litigation:${company.siren}`,
      priority: "medium",
      title: "Qualifier le contentieux et le rôle exact de l’entité",
      whyNow: "Le rapport automatisé n’attribue pas de risque judiciaire avant lecture et qualification partie/conseil/tiers.",
      scope: ["Judilibre multi-variantes", "déduplication", "rôle dans chaque décision", "issue et voies de recours"],
      expectedOutputs: ["corpus qualifié", "décisions représentatives", "aucun amalgame entre avocat et partie"],
      limitations: ["L’open data judiciaire est progressif et pseudonymisé."],
      requiresAdditionalAuthorization: false,
      launchPrompt: `Approfondis le contentieux public de ${company.nom_complet}, SIREN ${company.siren}, en qualifiant son rôle dans chaque décision.`,
    },
    {
      id: `explore-ownership:${company.siren}`,
      priority: "medium",
      title: "Établir la propriété et la répartition du capital",
      whyNow: "Les mandats ne suffisent pas à établir la détention économique ni les bénéficiaires effectifs.",
      scope: ["statuts datés", "cessions et augmentations de capital", "registre des bénéficiaires effectifs si accès légalement autorisé"],
      expectedOutputs: ["détentions prouvées et datées", "zones encore inconnues", "aucune inférence familiale automatique"],
      limitations: ["Le RBE et certaines pièces nécessitent une habilitation, un intérêt légitime ou une demande au tiers."],
      requiresAdditionalAuthorization: true,
      launchPrompt: `Approfondis l’actionnariat public et les pièces de capital de ${company.nom_complet}, SIREN ${company.siren}.`,
    },
    {
      id: `explore-public-contracts:${company.siren}`,
      priority: "medium",
      title: "Rechercher les marchés et clients publics démontrables",
      whyNow: "Les données DECP, BOAMP et TED peuvent révéler des attributions, montants, acheteurs et périodes qui ne figurent pas dans les registres sociaux.",
      scope: ["DECP", "BOAMP", "TED", "rôles et audiences administratives lorsque pertinents"],
      expectedOutputs: ["marchés attribués et datés", "acheteurs publics", "montants distinguant valeur réelle et plafond d’accord-cadre"],
      limitations: ["La complétude est variable et une attribution ne prouve ni bonne exécution ni dépendance économique."],
      requiresAdditionalAuthorization: false,
      launchPrompt: `Recherche les marchés publics attribués à ${company.nom_complet}, SIREN ${company.siren}, dans DECP, BOAMP et TED.`,
    },
    {
      id: `explore-reputation:${company.siren}`,
      priority: "low",
      title: "Analyser la réputation et la présence numérique",
      whyNow: "Le web peut compléter les registres par la presse, les classements professionnels, les publications et les avis réellement attribuables.",
      scope: ["presse", "site officiel", "réseaux professionnels publics", "classements", "avis substantiels"],
      expectedOutputs: ["corpus dédupliqué", "déclarations propres séparées des sources indépendantes", "homonymes exclus"],
      limitations: ["Les avis publics sont biaisés et ne permettent pas seuls une mesure fiable de qualité."],
      requiresAdditionalAuthorization: false,
      launchPrompt: `Approfondis la réputation publique et la présence numérique de ${company.nom_complet}, SIREN ${company.siren}.`,
    },
  );
  const priority = { high: 0, medium: 1, low: 2 } as const;
  return options.sort((left, right) => priority[left.priority] - priority[right.priority]);
}

export async function buildCompanyInvestigationReport(
  value: string,
  options: CompanyReportOptions = {},
  dependencies: CompanyReportDependencies = defaultDependencies,
): Promise<Record<string, unknown>> {
  const siren = assertSiren(value);
  const generatedAt = new Date().toISOString();
  const company = await dependencies.getCompany(siren);
  const aliases = uniqueAliases(company);
  const regulatoryRouting = routeRegulatoryChecks(company, generatedAt);

  const [graph, bodacc, collective, accounts, inpiRecord, attachments, adlcRuns] =
    await Promise.all([
      capture(() =>
        dependencies.buildGraph(siren, {
          maxPeople: options.maxPeople ?? 10,
          maxCompaniesPerPerson: options.maxCompaniesPerPerson ?? 50,
        }),
      ),
      capture(() => dependencies.getBodacc(siren, { limit: 100 })),
      capture(() => dependencies.getBodacc(siren, { family: "collective", limit: 100 })),
      capture(() => dependencies.getBodacc(siren, { family: "dpc", limit: 100 })),
      capture(() => dependencies.getInpiRecord(siren)),
      capture(() => dependencies.getInpiAttachments(siren)),
      Promise.all(aliases.map((alias) => capture(() => dependencies.searchAdlc(alias)))),
    ]);

  const subjectAnchor: RelationshipEndpoint = {
    id: `company:${siren}`,
    type: "company",
    label: company.nom_complet,
    siren,
  };
  const relationalSynthesis = buildRelationalSynthesis(
    subjectAnchor,
    graph.ok
      ? graph.value.linkedEntities.map((entity) => entity.connectionToAnchor)
      : [],
    options.documentaryRelationshipPaths ?? [],
  );

  const externalGraphObservations = (options.externalObservations ?? []).filter(
    (observation) => observation.field === "graph.linkedEntitySirens",
  );
  const officialLinkedSirens = new Set(
    graph.ok ? graph.value.linkedEntities.map((entity) => entity.siren) : [],
  );
  const externallyObservedSirens = new Set(
    externalGraphObservations.flatMap((observation) => extractSirens(observation.value)),
  );
  externallyObservedSirens.delete(siren);
  const externallyProvenMissingSirens = [...externallyObservedSirens].filter(
    (linkedSiren) => !officialLinkedSirens.has(linkedSiren),
  );
  const externalUndercoverageSources = [
    ...new Set(
      externalGraphObservations
        .filter((observation) =>
          extractSirens(observation.value).some((linkedSiren) =>
            externallyProvenMissingSirens.includes(linkedSiren),
          ),
        )
        .map((observation) => observation.source),
    ),
  ];
  const externalUndercoverageLimitation = externallyProvenMissingSirens.length > 0
    ? `Sous-couverture prouvée par ${externalUndercoverageSources.join(", ") || "une source externe"} : ${externallyProvenMissingSirens.length} SIREN lié(s) observé(s) ailleurs ne figurent pas dans le graphe officiel (${externallyProvenMissingSirens.join(", ")}).`
    : undefined;

  const graphCoverage: CoverageCheck = !graph.ok
    ? {
        id: "people-mandates",
        source: "API Recherche d’Entreprises",
        purpose: "Dirigeants et ramifications publiques",
        status: "failed",
        queriedAt: generatedAt,
        reason: graph.error,
        supportsNegativeConclusion: false,
      }
    : {
        id: "people-mandates",
        source: "API Recherche d’Entreprises",
        purpose: "Dirigeants et ramifications publiques",
        status:
          graph.value.coverage.peopleTruncated ||
          graph.value.peopleCoverage.some((item) => item.status !== "complete_for_query") ||
          externallyProvenMissingSirens.length > 0
            ? "partial"
            : "complete",
        queriedAt: generatedAt,
        returned: graph.value.coverage.peopleExamined,
        total: graph.value.coverage.peopleTotal,
        limitations: [
          ...graph.value.limitations,
          ...(externalUndercoverageLimitation ? [externalUndercoverageLimitation] : []),
        ],
        supportsNegativeConclusion:
          !graph.value.coverage.peopleTruncated &&
          graph.value.peopleCoverage.every((item) => item.status === "complete_for_query") &&
          externallyProvenMissingSirens.length === 0,
      };

  const adlcFailed = adlcRuns.some((item) => !item.ok);
  const adlcMatches = adlcRuns
    .flatMap((item) => (item.ok ? item.value.matches : []))
    .filter(
      (item, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.decisionId === item.decisionId && candidate.company === item.company,
        ) === index,
    );
  const coverage: CoverageCheck[] = [
    {
      id: "identity",
      source: entrepriseSource().name,
      purpose: "Identité courante au SIREN exact",
      status: "complete",
      queriedAt: generatedAt,
      returned: 1,
      total: 1,
      supportsNegativeConclusion: true,
    },
    graphCoverage,
    coverageFromBodacc("bodacc-all", "Historique des annonces", bodacc, generatedAt),
    coverageFromBodacc("bodacc-collective", "Procédures collectives", collective, generatedAt),
    coverageFromBodacc("bodacc-accounts", "Dépôts de comptes", accounts, generatedAt),
    sourceCoverage("rne", "DATA INPI", "État courant RNE", inpiRecord, generatedAt),
    sourceCoverage("inpi-documents", "DATA INPI", "Actes et comptes publics", attachments, generatedAt),
    {
      id: "adlc",
      source: "Autorité de la concurrence",
      purpose: `Sanctions financières, variantes : ${aliases.join(", ")}`,
      status: adlcFailed ? "partial" : "complete",
      queriedAt: generatedAt,
      returned: adlcMatches.length,
      limitations: ["Correspondance textuelle à confirmer dans la décision source en cas d’homonyme."],
      supportsNegativeConclusion: !adlcFailed,
    },
    {
      id: "regulatory-sector",
      source: "Routeur réglementaire sectoriel / sources officielles sélectionnées",
      purpose: regulatoryRouting.selectedRoutes
        .map((route) => `${route.id}: ${route.title}`)
        .join(" ; "),
      status: "not_checked",
      queriedAt: generatedAt,
      reason:
        "Le routage est terminé, mais les registres sélectionnés n’ont pas encore tous été interrogés dans ce rapport.",
      limitations: [regulatoryRouting.warning],
      supportsNegativeConclusion: false,
    },
    {
      id: "beneficial-owners",
      source: "RNE / registre des bénéficiaires effectifs",
      purpose: "Bénéficiaires effectifs et détention économique",
      status: "restricted",
      queriedAt: generatedAt,
      reason: "Accès soumis à habilitation, intérêt légitime ou autre base légale applicable.",
      supportsNegativeConclusion: false,
    },
    {
      id: "litigation",
      source: "Judilibre et juridictions administratives",
      purpose: "Contentieux avec qualification du rôle",
      status: "not_checked",
      queriedAt: generatedAt,
      reason: "La recherche automatisée brute ne suffit pas ; les décisions doivent être lues et dédupliquées.",
      supportsNegativeConclusion: false,
    },
    {
      id: "reputation",
      source: "Web public",
      purpose: "Presse, présence numérique et avis substantiels",
      status: "not_checked",
      queriedAt: generatedAt,
      reason: "Ce volet exige une recherche web contextualisée et une désambiguïsation distincte.",
      supportsNegativeConclusion: false,
    },
  ];

  const attachmentCounts = attachments.ok ? arrayCounts(attachments.value.attachments) : {};
  const providedMaterialFindings = normalizeDocumentaryFindings(
    options.documentaryFindings ?? [],
  );
  const primaryDocumentsRead = providedMaterialFindings.filter((finding) =>
    finding.evidence.some((evidence) => evidence.level === "primary_document"),
  ).length;
  const finances = financialAvailability(company, accounts);
  const economicFootprint = buildEconomicFootprint(company, options.economicFootprint);
  const leads: InvestigationLead[] = [];
  if (graph.ok) {
    for (const entity of graph.value.linkedEntities) {
      leads.push({
        id: `linked:${entity.siren}`,
        priority: entity.priority,
        category: "linked_entity",
        title: `${entity.kind === "sci" ? "SCI" : "Entité"} liée à approfondir : ${entity.name}`,
        rationale: `Chemin au pivot : ${entity.connectionToAnchor.summary}. La confiance globale du chemin est ${entity.connectionToAnchor.confidence}.`,
        relatedSiren: entity.siren,
        relatedPerson: entity.person,
        anchorPathId: entity.connectionToAnchor.id,
        nextChecks: ["RNE et BODACC propres", "statuts et actes", "autres mandats", "lien opérationnel éventuel avec la cible"],
      });
    }
  }
  if ((attachmentCounts.actes ?? 0) > 0 && primaryDocumentsRead === 0) {
    leads.push({
      id: "document-insight",
      priority: "high",
      category: "document",
      title: "Lire au moins un acte public avant toute conclusion documentaire",
      rationale: `${attachmentCounts.actes} acte(s) sont inventoriés, mais aucun constat transmis au rapport ne provient encore de la lecture d'une pièce primaire.`,
      nextChecks: [
        "ouvrir les actes accessibles",
        "relever page et date",
        "extraire les clauses et décisions matérielles",
        "séparer le contenu lu des seules métadonnées",
      ],
    });
  }
  if (finances.status !== "available") {
    leads.push({
      id: "financial-availability",
      priority: finances.status === "confidential" ? "medium" : "high",
      category: "financial",
      title: "Qualifier les informations financières indisponibles",
      rationale: finances.explanation,
      nextChecks: ["documents à demander au tiers", "dépôts BODACC", "indicateurs d’activité publics datés"],
    });
  }
  leads.push(
    {
      id: "regulatory-router",
      priority: regulatoryRouting.selectedRoutes.some((route) => route.priority === "high")
        ? "high"
        : "medium",
      category: "regulatory",
      title: "Exécuter les contrôles réglementaires sectoriels sélectionnés",
      rationale:
        `Le code NAF ${company.activite_principale ?? "non renseigné"} a routé ${regulatoryRouting.selectedRoutes.length} contrôle(s) gratuit(s) vers : ${regulatoryRouting.selectedRoutes.map((route) => route.title).join(", ")}. Le routage n’est pas un résultat.`,
      nextChecks: regulatoryRouting.selectedRoutes.map((route) => route.recommendedAction),
    },
    {
      id: "litigation-role",
      priority: "medium",
      category: "litigation",
      title: "Rechercher et qualifier le contentieux",
      rationale: "Une occurrence judiciaire ne constitue un signal qu’après qualification du rôle de l’entité.",
      nextChecks: ["variantes de dénomination", "déduplication", "partie/conseil/tiers", "solution et recours"],
    },
    {
      id: "ownership-proof",
      priority: "medium",
      category: "ownership",
      title: "Établir la détention économique par des pièces datées",
      rationale: "Les mandats et qualités de dirigeant ne prouvent pas la répartition du capital.",
      nextChecks: ["statuts", "cessions de parts", "mouvements de capital", "RBE si accès autorisé"],
    },
  );

  const officialObservations: FactObservation[] = [
    { field: "identity.name", value: company.nom_complet, source: entrepriseSource().name, observedAt: generatedAt },
    { field: "identity.administrativeState", value: company.etat_administratif, source: entrepriseSource().name, observedAt: generatedAt },
    { field: "identity.legalFormCode", value: company.nature_juridique, source: entrepriseSource().name, observedAt: generatedAt },
    { field: "governance.directorCount", value: company.dirigeants?.length ?? 0, source: entrepriseSource().name, observedAt: generatedAt },
    { field: "finance.publicExerciseCount", value: finances.publicExerciseCount, source: entrepriseSource().name, observedAt: generatedAt },
  ];
  if (attachmentCounts.actes !== undefined) {
    officialObservations.push({
      field: "documents.actCount",
      value: attachmentCounts.actes,
      source: "DATA INPI",
      observedAt: generatedAt,
    });
  }
  if (graph.ok) {
    officialObservations.push({
      field: "graph.linkedEntitySirens",
      value: graph.value.linkedEntities.map((item) => item.siren).sort(),
      source: entrepriseSource().name,
      observedAt: generatedAt,
    });
  }
  const contradictions = reconcileObservations([
    ...officialObservations,
    ...(options.externalObservations ?? []),
  ]);

  const inventoryFindings: MaterialFinding[] =
    attachments.ok && (attachmentCounts.actes ?? 0) > 0
      ? [
          {
            id: `structure:public-acts:${siren}`,
            title: "Actes publics inventoriés",
            category: "document",
            priority: "medium",
            establishedFact: `DATA INPI inventorie ${attachmentCounts.actes} acte(s) public(s) pour le SIREN ${siren}.`,
            whyItMatters:
              "Ces pièces constituent des sources primaires potentielles pour dater les statuts, pouvoirs, mouvements de capital et changements de gouvernance.",
            evidence: [
              {
                level: "official_metadata",
                source: attachments.value.source.name,
                page: null,
                date: attachments.value.source.retrievedAt,
                reference: attachments.value.source.url,
              },
            ],
            whatItDoesNotProve: [
              "L'inventaire ne prouve pas que le texte des actes a été ouvert, lu ou OCRisé.",
              "Il ne permet pas, à lui seul, d'attribuer une clause, une décision ou une détention à une personne.",
            ],
            nextVerification: [
              "Ouvrir chaque pièce accessible, relever sa date et ses pages utiles, puis extraire des affirmations atomiques.",
            ],
            origin: "structural_deduction",
          },
        ]
      : [];
  const concentrationFindings = (options.externalObservations ?? [])
    .filter((observation) =>
      /^ownership\.initial(?:Concentration|_concentration)$/i.test(observation.field),
    )
    .map(structuralObservationFinding);
  const indexingFindings: MaterialFinding[] = contradictions
    .filter((contradiction) =>
      contradiction.kind === "coverage_mismatch" &&
      /document|act|piece|count|nombre/i.test(contradiction.id),
    )
    .map((contradiction, index) => ({
      id: materialFindingId("indexing", "Écart d'indexation documentaire", index),
      title: "Écart d'indexation documentaire",
      category: "indexing",
      priority: "high",
      establishedFact: contradiction.summary,
      whyItMatters:
        "Une source peut omettre des pièces présentes dans une autre ; les recherches documentaires et les conclusions de couverture doivent donc partir de l'inventaire le plus direct.",
      evidence: [
        {
          level: "corroborated_sources",
          source: [...new Set(contradiction.observations.map((item) => item.source))].join(" / "),
          page: null,
          date:
            contradiction.observations.find((item) => item.observedAt)?.observedAt ?? generatedAt,
        },
      ],
      whatItDoesNotProve: [
        "Cet écart ne prouve pas que les actes manquants n'existent pas.",
        "Il ne permet pas de conclure sur le contenu ou les effets juridiques des pièces non lues.",
      ],
      nextVerification: [
        "Reprendre l'inventaire DATA INPI, ouvrir les références disponibles et documenter précisément les absences de l'autre index.",
      ],
      origin: "structural_deduction",
    }));
  const materialFindingMap = new Map<string, MaterialFinding>();
  for (const finding of [
    ...providedMaterialFindings,
    ...inventoryFindings,
    ...concentrationFindings,
    ...indexingFindings,
  ]) {
    materialFindingMap.set(finding.id, finding);
  }
  const allMaterialFindings = [...materialFindingMap.values()].sort((left, right) => {
    const priority = { high: 0, medium: 1, low: 2 } as const;
    return priority[left.priority] - priority[right.priority];
  });
  const connectedPathIds = new Set(
    [...relationalSynthesis.primaryPaths, ...relationalSynthesis.alternativePaths].map(
      (path) => path.id,
    ),
  );
  const findingIsConnected = (finding: MaterialFinding): boolean => {
    if (!finding.subject || endpointMatches(finding.subject, subjectAnchor)) return true;
    return (finding.relationshipPathIds ?? []).some((pathId) => connectedPathIds.has(pathId));
  };
  const materialFindings = allMaterialFindings.filter(findingIsConnected);
  const orphanMaterialFindings = allMaterialFindings
    .filter((finding) => !findingIsConnected(finding))
    .map((finding) => ({
      ...finding,
      exclusionReason:
        "Le constat concerne un sujet secondaire mais ne référence aucun chemin vérifié ou corroboré vers le pivot.",
    }));

  const completionWeight = coverage.reduce(
    (sum, item) =>
      sum +
      (item.status === "complete" || item.status === "restricted"
        ? 1
        : item.status === "partial"
          ? 0.5
          : 0),
    0,
  );
  const completionPercent = coverage.length === 0
    ? 0
    : Math.round((completionWeight / coverage.length) * 100);
  const dataAvailabilityPercent = coverage.length === 0
    ? 0
    : Math.round(
        (coverage.filter((item) => item.status === "complete").length / coverage.length) * 100,
      );
  const criticalCoverageComplete = coverage
    .filter((item) => ["identity", "people-mandates", "bodacc-collective", "adlc", "regulatory-sector"].includes(item.id))
    .every((item) => item.status === "complete");
  const unconnectedLinkedEntities = graph.ok
    ? graph.value.linkedEntities.filter(
        (entity) => !connectedPathIds.has(entity.connectionToAnchor.id),
      )
    : [];
  const relationshipEvidenceComplete = relationalSynthesis.primaryPaths.every((path) =>
    path.steps.every(
      (step) =>
        step.exactMechanism.trim().length > 0 &&
        step.evidence.length > 0 &&
        step.evidence.every((evidence) => Object.prototype.hasOwnProperty.call(evidence, "date")),
    ),
  );

  const qualityGates: QualityGate[] = [
    {
      id: "PIVOT-01",
      label: "Le sujet pivot est défini et désambiguïsé",
      status: "pass",
      detail: `${company.nom_complet} est défini comme pivot par le SIREN ${siren}.`,
    },
    {
      id: "PATH-01",
      label: "Chaque ramification principale possède un chemin prouvé vers le pivot",
      status: !graph.ok || unconnectedLinkedEntities.length > 0
        ? "fail"
        : relationalSynthesis.candidatePaths.length > 0 ||
            relationalSynthesis.contradictedPaths.length > 0 ||
            relationalSynthesis.orphanPaths.length > 0
          ? "warning"
          : "pass",
      detail: !graph.ok
        ? "Le graphe de découverte est indisponible ; les chemins automatiques ne peuvent pas être certifiés."
        : unconnectedLinkedEntities.length > 0
          ? `${unconnectedLinkedEntities.length} ramification(s) principale(s) ne possèdent pas de chemin exploitable vers le pivot.`
          : `${relationalSynthesis.primaryPaths.length} cible(s) reliée(s) par un chemin principal ; les candidats, contradictions et chemins invalides sont séparés.`,
    },
    {
      id: "RELATION-EVIDENCE-01",
      label: "Chaque maillon expose son mécanisme, sa preuve, sa date et ses limites",
      status: relationshipEvidenceComplete ? "pass" : "fail",
      detail: relationshipEvidenceComplete
        ? "Tous les maillons des chemins principaux comportent un mécanisme exact et une preuve datée ou explicitement sans date."
        : "Au moins un maillon principal est insuffisamment documenté.",
    },
    {
      id: "ORPHAN-01",
      label: "Les faits sans chemin au pivot sont exclus du corps principal",
      status:
        orphanMaterialFindings.length > 0 || relationalSynthesis.orphanPaths.length > 0
          ? "warning"
          : "pass",
      detail:
        orphanMaterialFindings.length > 0 || relationalSynthesis.orphanPaths.length > 0
          ? `${orphanMaterialFindings.length} constat(s) et ${relationalSynthesis.orphanPaths.length} chemin(s) invalide(s) sont placés en annexe, sans être présentés comme des ramifications.`
          : "Aucun fait secondaire orphelin n'est présenté dans le corps principal.",
    },
    {
      id: "IDENTITY-01",
      label: "Identité verrouillée par SIREN et source primaire",
      status: "pass",
      detail: `SIREN ${siren} résolu directement dans ${entrepriseSource().name}.`,
    },
    {
      id: "PEOPLE-01",
      label: "Tous les représentants courants ont été explorés sans troncature",
      status: graphCoverage.status === "complete" ? "pass" : graphCoverage.status === "failed" ? "fail" : "warning",
      detail: graphCoverage.status === "complete"
        ? "La recherche nominative couvre tous les représentants diffusés par la fiche courante."
        : "La recherche de mandats est partielle ou indisponible ; aucune absence de ramification ne peut être conclue.",
    },
    {
      id: "SCI-01",
      label: "Les SCI et sociétés civiles trouvées sont restituées séparément",
      status: !graph.ok ? "fail" : graphCoverage.status === "complete" ? "pass" : "warning",
      detail: graph.ok
        ? graphCoverage.status === "complete"
          ? `${graph.value.linkedEntities.filter((item) => item.kind === "sci" || item.kind === "civil_company").length} SCI ou société(s) civile(s) restituée(s).`
          : `${graph.value.linkedEntities.filter((item) => item.kind === "sci" || item.kind === "civil_company").length} SCI ou société(s) civile(s) restituée(s), mais la couverture des ramifications est partielle.`
        : "Le graphe n’a pas pu être construit.",
    },
    {
      id: "DOCUMENT-INSIGHT",
      label: "L'inventaire des actes est distingué de leur lecture analytique",
      status: !attachments.ok
        ? "fail"
        : (attachmentCounts.actes ?? 0) > 0 && primaryDocumentsRead === 0
          ? "warning"
          : "pass",
      detail: !attachments.ok
        ? "L'inventaire DATA INPI n'a pas pu être récupéré."
        : (attachmentCounts.actes ?? 0) === 0
          ? "Aucun acte n'est inventorié dans la source consultée ; aucune analyse documentaire n'est revendiquée."
          : primaryDocumentsRead === 0
            ? `${attachmentCounts.actes} acte(s) sont inventoriés, mais aucun constat matériel ne provient encore de la lecture d'une pièce primaire.`
            : `${primaryDocumentsRead} constat(s) matériel(s) proviennent de la lecture d'au moins une pièce primaire, avec source, page et date explicites.`,
    },
    {
      id: "FINANCE-01",
      label: "La disponibilité financière est qualifiée sans inférence de solvabilité",
      status: finances.status === "source_failed" ? "fail" : "pass",
      detail: finances.explanation,
    },
    {
      id: "ECONOMIC-FOOTPRINT-01",
      label: "Entreprise, flux personnels et patrimoine restent séparés",
      status: "pass",
      detail:
        "Les valeurs publiées, les calculs, les scénarios et les éléments non déterminables sont étiquetés ; aucun mandat n’est converti automatiquement en détention, rémunération ou patrimoine.",
    },
    {
      id: "REGULATORY-ROUTER-01",
      label: "Les sources réglementaires sont sélectionnées sans être confondues avec des contrôles exécutés",
      status: "warning",
      detail:
        `${regulatoryRouting.selectedRoutes.length} route(s) officielle(s) ont été sélectionnée(s) ; elles restent explicitement marquées routed_not_checked jusqu’à leur interrogation et à la désambiguïsation des résultats.`,
    },
    {
      id: "CONTRADICTION-01",
      label: "Les divergences externes sont conservées et classées",
      status: contradictions.some((item) => item.severity === "high") ? "fail" : contradictions.length > 0 ? "warning" : "pass",
      detail: `${contradictions.length} divergence(s) structurée(s).`,
    },
    {
      id: "NEGATIVE-01",
      label: "Les conclusions négatives sont limitées aux contrôles complets",
      status: criticalCoverageComplete ? "pass" : "warning",
      detail: criticalCoverageComplete
        ? "Les contrôles critiques automatiques sont complets pour leurs filtres déclarés."
        : "Au moins un contrôle critique est partiel ; le rapport interdit toute formulation absolue d’absence.",
    },
  ];

  const sourceRefs: SourceRef[] = [entrepriseSource()];
  if (bodacc.ok) sourceRefs.push(bodacc.value.source);
  if (attachments.ok) sourceRefs.push(attachments.value.source);
  for (const run of adlcRuns) if (run.ok) sourceRefs.push(run.value.source);

  const signals: Array<Record<string, unknown>> = [];
  if (company.etat_administratif && company.etat_administratif !== "A") {
    signals.push({ severity: "high", category: "administrative", finding: "L’unité légale ne paraît pas active dans la fiche consultée." });
  }
  if (collective.ok && collective.value.total > 0) {
    signals.push({ severity: "high", category: "legal", finding: `${collective.value.total} annonce(s) de procédure collective ont été trouvées.`, evidence: collective.value.records });
  }
  if (adlcMatches.length > 0) {
    signals.push({ severity: "medium", category: "legal", finding: `${adlcMatches.length} correspondance(s) ont été trouvées dans le jeu AdlC.`, evidence: adlcMatches });
  }

  return {
    schemaVersion: "0.6.0",
    metadata: {
      generatedAt,
      subjectSiren: siren,
      scope: "Sources officielles automatisées du MCP osint-business et routeur réglementaire sectoriel ; Origami, data.gouv.fr, Docling local et le web peuvent compléter l’exécution comme sources ou observations externes.",
    },
    subjectAnchor,
    relationshipMap: relationalSynthesis,
    executiveConclusion: signals.length > 0
      ? `${signals.length} signal(aux) nécessitent une contextualisation par les pièces.`
      : criticalCoverageComplete
        ? "Aucun signal majeur n’a été trouvé dans les contrôles automatiques complets déclarés ; ce résultat n’est pas un certificat d’absence de risque."
        : "Aucun signal majeur n’a été établi, mais la couverture critique est incomplète : aucune conclusion rassurante globale n’est autorisée.",
    identity: {
      siren,
      name: company.nom_complet,
      administrativeState: company.etat_administratif,
      legalFormCode: company.nature_juridique,
      activityCode: company.activite_principale,
      creationDate: company.date_creation,
      headOffice: company.siege,
      aliases,
      source: entrepriseSource(),
    },
    governance: {
      currentRepresentatives: (company.dirigeants ?? []).map(publicRepresentativeSummary),
      representativeCount: company.dirigeants?.length ?? 0,
    },
    ramifications: graph.ok
      ? {
          nodes: graph.value.nodes,
          edges: graph.value.edges,
          linkedEntities: graph.value.linkedEntities,
          candidateEdges: graph.value.candidateEdges,
          peopleCoverage: graph.value.peopleCoverage,
          coverage: graph.value.coverage,
          limitations: graph.value.limitations,
        }
      : { unavailable: true, error: graph.error },
    materialFindings,
    orphanFindings: {
      materialFindings: orphanMaterialFindings,
      invalidRelationshipPaths: relationalSynthesis.orphanPaths,
      note:
        "Ces éléments sont conservés pour audit mais ne sont pas présentés comme des ramifications du sujet pivot.",
    },
    chronology: bodacc.ok
      ? { announcements: bodacc.value.records, total: bodacc.value.total, coverage: bodacc.value.coverage }
      : { unavailable: true, error: bodacc.error },
    documents: attachments.ok
      ? { collectionCounts: attachmentCounts, source: attachments.value.source, limitations: attachments.value.limitations }
      : { unavailable: true, error: attachments.error },
    finance: {
      ...finances,
      publicValues: company.finances ?? {},
      warning: "Le capital social, pris isolément, n’est ni un chiffre d’affaires ni un indicateur de solvabilité.",
    },
    economicFootprint,
    procedures: collective.ok
      ? { total: collective.value.total, records: collective.value.records, coverage: collective.value.coverage }
      : { unavailable: true, error: collective.error },
    competitionSanctions: {
      aliasesQueried: aliases,
      matches: adlcMatches,
      incomplete: adlcFailed,
    },
    regulatoryRouting,
    signals,
    contradictions,
    coverage: {
      completionPercent,
      dataAvailabilityPercent,
      criticalDomainsComplete: criticalCoverageComplete,
      checks: coverage,
      note: "completionPercent mesure les contrôles exécutés, y compris une restriction légalement constatée ; dataAvailabilityPercent mesure les contrôles ayant effectivement livré une source complète. Aucun des deux n’est un score de risque.",
    },
    qualityGates,
    informationGaps: coverage
      .filter((item) => item.status !== "complete")
      .map((item) => ({
        domain: item.id,
        status: item.status,
        reason: item.reason ?? item.limitations?.join(" ") ?? "Couverture partielle.",
        supportsNegativeConclusion: item.supportsNegativeConclusion,
      })),
    prioritizedLeads: leads,
    explorationMenu: buildExplorationMenu(
      company,
      graph,
      finances,
      attachmentCounts,
      relationalSynthesis,
      regulatoryRouting,
    ),
    suggestedClosingQuestion:
      "Voici les pistes supplémentaires classées par priorité. Laquelle souhaites-tu que je lance ? Tu peux répondre avec l’identifiant de l’option ou reprendre son launchPrompt.",
    evidenceRegister: {
      sources: sourceRefs.filter(
        (item, index, values) => values.findIndex((candidate) => candidate.name === item.name) === index,
      ),
      externalObservations: options.externalObservations ?? [],
      documentaryRelationshipPaths: options.documentaryRelationshipPaths ?? [],
    },
  };
}
