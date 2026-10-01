#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildCompanyMandateGraph } from "./analysis/graph.js";
import { assessCompanyOperatingStatus } from "./analysis/company-status.js";
import {
  buildEconomicFootprint,
  type EconomicFootprintOptions,
} from "./analysis/economic-footprint.js";
import { resolveCompanyIdentity } from "./analysis/identity.js";
import { buildCompanyInvestigationReport } from "./analysis/report.js";
import { routeRegulatoryChecks } from "./analysis/regulatory-router.js";
import { triageCompany } from "./analysis/triage.js";
import { searchAdlcSanctions } from "./connectors/adlc.js";
import { queryDvfPropertyTransactions } from "./connectors/dvf.js";
import { getBodaccHistory } from "./connectors/bodacc.js";
import {
  downloadInpiActPdf,
  downloadInpiBalancePdf,
  getInpiAttachments,
  getInpiCompany,
  getInpiStructuredBalance,
} from "./connectors/inpi.js";
import {
  getJudilibreDecision,
  searchJudilibre,
} from "./connectors/judilibre.js";
import {
  entrepriseSource,
  getCompanyBySiren,
  searchPersonMandates,
} from "./connectors/recherche-entreprises.js";

const server = new McpServer({
  name: "osint-business-fr",
  version: "1.0.0",
});

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

const relationshipEndpointSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["company", "person", "other_legal_entity"]),
  label: z.string().min(1),
  siren: z.string().regex(/^\d{9}$/).optional(),
});

const relationshipEvidenceSchema = z.object({
  level: z.enum([
    "primary_document",
    "official_metadata",
    "corroborated_sources",
    "external_observation",
  ]),
  source: z.string().min(1),
  page: z.string().min(1).nullable(),
  date: z.string().min(1).nullable(),
  reference: z.string().min(1).optional(),
});

const relationshipStepSchema = z.object({
  from: relationshipEndpointSchema,
  to: relationshipEndpointSchema,
  relation: z.enum([
    "professional_mandate",
    "corporate_representative",
    "management",
    "declared_associate",
    "ownership_full",
    "ownership_bare",
    "usufruct",
    "legal_representation",
    "power_of_attorney",
    "family_explicit",
    "transaction",
    "procedural_or_litigation",
    "shared_address_context",
    "other",
  ]),
  exact_mechanism: z.string().min(1),
  verification_status: z.enum(["verified", "corroborated", "candidate", "contradicted"]),
  temporal_status: z.enum(["current", "historical", "unknown"]),
  confidence: z.enum(["high", "medium", "low"]),
  effective_at: z.string().nullable().optional(),
  ended_at: z.string().nullable().optional(),
  evidence: z.array(relationshipEvidenceSchema).min(1).max(10),
  limitations: z.array(z.string().min(1)).min(1).max(20),
});

const supplementalFinancialStatementSchema = z.object({
  exercise: z.string().min(4).max(32),
  revenue: z.number().finite().optional(),
  net_income: z.number().finite().optional(),
  ebitda: z.number().finite().optional(),
  cash: z.number().finite().optional(),
  financial_debt: z.number().finite().optional(),
  equity: z.number().finite().optional(),
  total_assets: z.number().finite().optional(),
  current_assets: z.number().finite().optional(),
  current_liabilities: z.number().finite().optional(),
  evidence: z.array(relationshipEvidenceSchema).min(1).max(10),
  limitations: z.array(z.string().min(1)).max(20).optional(),
});

const economicFootprintSchema = z.object({
  subject_person: z.object({
    name: z.string().min(1),
    relationship_path_id: z.string().min(1).optional(),
  }).optional(),
  supplemental_statements: z.array(supplementalFinancialStatementSchema).max(20).optional(),
  ownership: z.object({
    percentage: z.number().min(0).max(100),
    effective_at: z.string().min(1).optional(),
    verification_status: z.enum(["verified", "corroborated"]),
    evidence: z.array(relationshipEvidenceSchema).min(1).max(10),
    limitations: z.array(z.string().min(1)).min(1).max(20),
    relationship_path_id: z.string().min(1).optional(),
  }).optional(),
  flows: z.array(z.object({
    category: z.enum([
      "mandate_compensation",
      "employment_salary",
      "dividend",
      "company_distribution",
      "shareholder_current_account_repayment",
      "other",
    ]),
    amount: z.number().finite().nonnegative(),
    period: z.string().min(1),
    recipient_scope: z.enum(["person", "company_total"]),
    evidence: z.array(relationshipEvidenceSchema).min(1).max(10),
    limitations: z.array(z.string().min(1)).min(1).max(20),
  })).max(100).optional(),
  valuation_assumptions: z.object({
    earnings_multiple_low: z.number().positive().optional(),
    earnings_multiple_high: z.number().positive().optional(),
    net_debt: z.number().finite().optional(),
    rationale: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
  }).optional(),
});

function mapEconomicFootprintOptions(
  input?: z.infer<typeof economicFootprintSchema>,
): EconomicFootprintOptions | undefined {
  if (!input) return undefined;
  return {
    ...(input.subject_person
      ? {
          subjectPerson: {
            name: input.subject_person.name,
            ...(input.subject_person.relationship_path_id
              ? { relationshipPathId: input.subject_person.relationship_path_id }
              : {}),
          },
        }
      : {}),
    ...(input.supplemental_statements
      ? {
          supplementalStatements: input.supplemental_statements.map((statement) => ({
            exercise: statement.exercise,
            ...(statement.revenue !== undefined ? { revenue: statement.revenue } : {}),
            ...(statement.net_income !== undefined ? { netIncome: statement.net_income } : {}),
            ...(statement.ebitda !== undefined ? { ebitda: statement.ebitda } : {}),
            ...(statement.cash !== undefined ? { cash: statement.cash } : {}),
            ...(statement.financial_debt !== undefined
              ? { financialDebt: statement.financial_debt }
              : {}),
            ...(statement.equity !== undefined ? { equity: statement.equity } : {}),
            ...(statement.total_assets !== undefined ? { totalAssets: statement.total_assets } : {}),
            ...(statement.current_assets !== undefined
              ? { currentAssets: statement.current_assets }
              : {}),
            ...(statement.current_liabilities !== undefined
              ? { currentLiabilities: statement.current_liabilities }
              : {}),
            evidence: statement.evidence.map(relationshipEvidence),
            ...(statement.limitations ? { limitations: statement.limitations } : {}),
          })),
        }
      : {}),
    ...(input.ownership
      ? {
          ownership: {
            percentage: input.ownership.percentage,
            verificationStatus: input.ownership.verification_status,
            evidence: input.ownership.evidence.map(relationshipEvidence),
            limitations: input.ownership.limitations,
            ...(input.ownership.effective_at ? { effectiveAt: input.ownership.effective_at } : {}),
            ...(input.ownership.relationship_path_id
              ? { relationshipPathId: input.ownership.relationship_path_id }
              : {}),
          },
        }
      : {}),
    ...(input.flows
      ? {
          flows: input.flows.map((flow) => ({
            category: flow.category,
            amount: flow.amount,
            period: flow.period,
            recipientScope: flow.recipient_scope,
            evidence: flow.evidence.map(relationshipEvidence),
            limitations: flow.limitations,
          })),
        }
      : {}),
    ...(input.valuation_assumptions
      ? {
          valuationAssumptions: {
            ...(input.valuation_assumptions.earnings_multiple_low !== undefined
              ? { earningsMultipleLow: input.valuation_assumptions.earnings_multiple_low }
              : {}),
            ...(input.valuation_assumptions.earnings_multiple_high !== undefined
              ? { earningsMultipleHigh: input.valuation_assumptions.earnings_multiple_high }
              : {}),
            ...(input.valuation_assumptions.net_debt !== undefined
              ? { netDebt: input.valuation_assumptions.net_debt }
              : {}),
            ...(input.valuation_assumptions.rationale
              ? { rationale: input.valuation_assumptions.rationale }
              : {}),
            ...(input.valuation_assumptions.source
              ? { source: input.valuation_assumptions.source }
              : {}),
          },
        }
      : {}),
  };
}

function relationshipEndpoint(
  endpoint: z.infer<typeof relationshipEndpointSchema>,
) {
  return {
    id: endpoint.id,
    type: endpoint.type,
    label: endpoint.label,
    ...(endpoint.siren ? { siren: endpoint.siren } : {}),
  };
}

function relationshipEvidence(
  evidence: z.infer<typeof relationshipEvidenceSchema>,
) {
  return {
    level: evidence.level,
    source: evidence.source,
    page: evidence.page,
    date: evidence.date,
    ...(evidence.reference ? { reference: evidence.reference } : {}),
  };
}

server.registerTool(
  "resolve_company",
  {
    title: "Résoudre une entreprise française",
    description:
      "Recherche gratuite par dénomination, adresse, SIREN ou SIRET. Retourne les candidats diffusables et leur source officielle.",
    inputSchema: {
      query: z.string().min(2),
      limit: z.number().int().min(1).max(25).default(10),
      commune: z.string().optional(),
      postal_code: z.string().regex(/^\d{5}$/).optional(),
      address: z.string().optional(),
      activity_code: z.string().optional(),
      director_name: z.string().optional(),
    },
  },
  async ({ query, limit, commune, postal_code, address, activity_code, director_name }) =>
    result(
      await resolveCompanyIdentity(
        query,
        {
          ...(commune ? { commune } : {}),
          ...(postal_code ? { postalCode: postal_code } : {}),
          ...(address ? { address } : {}),
          ...(activity_code ? { activityCode: activity_code } : {}),
          ...(director_name ? { directorName: director_name } : {}),
        },
        limit,
      ),
    ),
);

server.registerTool(
  "get_company_snapshot",
  {
    title: "Fiche publique d’une entreprise",
    description:
      "Récupère une fiche publique par SIREN : identité, siège, activité, tranche d’effectif datée, dirigeants et finances disponibles.",
    inputSchema: { siren: z.string() },
  },
  async ({ siren }) => {
    const company = await getCompanyBySiren(siren);
    const inpi = await getInpiCompany(siren).catch(() => undefined);
    return result({
      company,
      reconciledStatus: assessCompanyOperatingStatus(company, inpi?.record),
      source: entrepriseSource(),
      ...(inpi ? { statusSource: inpi.source } : {}),
    });
  },
);

server.registerTool(
  "query_dvf_property_transactions",
  {
    title: "Rechercher des mutations DVF à une adresse",
    description:
      "Interroge le fichier départemental officiel DVF, filtre une adresse et un prix éventuel, puis regroupe les lignes par id_mutation afin de ne pas compter plusieurs fois une même vente. DVF ne publie pas l’identité des parties.",
    inputSchema: {
      year: z
        .number()
        .int()
        .min(new Date().getUTCFullYear() - 5)
        .max(new Date().getUTCFullYear() - 1),
      department: z.string().regex(/^(?:\d{2,3}|2A|2B)$/i),
      street_number: z.string().min(1).max(10),
      street_name: z.string().min(2).max(160),
      postal_code: z.string().regex(/^\d{5}$/).optional(),
      target_value: z.number().nonnegative().optional(),
      value_tolerance: z.number().nonnegative().default(0),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      max_mutations: z.number().int().min(1).max(200).default(50),
    },
  },
  async ({
    year,
    department,
    street_number,
    street_name,
    postal_code,
    target_value,
    value_tolerance,
    date_from,
    date_to,
    max_mutations,
  }) =>
    result(
      await queryDvfPropertyTransactions({
        year,
        department,
        streetNumber: street_number,
        streetName: street_name,
        ...(postal_code ? { postalCode: postal_code } : {}),
        ...(target_value === undefined ? {} : { targetValue: target_value }),
        valueTolerance: value_tolerance,
        ...(date_from ? { dateFrom: date_from } : {}),
        ...(date_to ? { dateTo: date_to } : {}),
        maxMutations: max_mutations,
      }),
    ),
);

server.registerTool(
  "analyze_economic_footprint",
  {
    title: "Analyser la santé financière et l’empreinte économique",
    description:
      "Analyse gratuitement les exercices publics d’une société, calcule des indicateurs reproductibles et, si les preuves sont fournies, distingue détention, rémunération, dividendes et exposition économique d’une personne. Toute fourchette de valeur est un scénario explicite, jamais un prix certain ni un patrimoine personnel.",
    inputSchema: {
      siren: z.string(),
      economic_footprint: economicFootprintSchema.optional(),
    },
  },
  async ({ siren, economic_footprint }) => {
    const company = await getCompanyBySiren(siren);
    return result(buildEconomicFootprint(company, mapEconomicFootprintOptions(economic_footprint)));
  },
);

server.registerTool(
  "route_regulatory_checks",
  {
    title: "Router les contrôles réglementaires sectoriels",
    description:
      "Sélectionne gratuitement les registres et régulateurs officiels pertinents à partir du SIREN et du code NAF : gels d’avoirs transversal, finance, CNAPS, CNB, ICPE, RappelConso/DGCCRF, CNIL, santé, transport, RGE ou formation. Le routage ne prétend jamais que les contrôles ont déjà été exécutés.",
    inputSchema: { siren: z.string() },
  },
  async ({ siren }) => {
    const company = await getCompanyBySiren(siren);
    return result(routeRegulatoryChecks(company));
  },
);

server.registerTool(
  "search_person_mandates",
  {
    title: "Rechercher les mandats publics d’un dirigeant",
    description:
      "Recherche les sociétés liées à une personne par mandats publics. Fournir le mois de naissance (YYYY-MM) augmente fortement la fiabilité du rapprochement.",
    inputSchema: {
      nom: z.string().min(1),
      prenoms: z.string().optional(),
      date_naissance: z.string().regex(/^\d{4}(-\d{2})?$/).optional(),
      max_results: z.number().int().min(1).max(100).default(100),
    },
  },
  async ({ nom, prenoms, date_naissance, max_results }) =>
    result(
      await searchPersonMandates({
        nom,
        ...(prenoms ? { prenoms } : {}),
        ...(date_naissance ? { dateNaissance: date_naissance } : {}),
        maxResults: max_results,
      }),
    ),
);

server.registerTool(
  "build_company_mandate_graph",
  {
    title: "Cartographier les ramifications publiques",
    description:
      "Construit un graphe de découverte autour d’une société ou SCI et conserve, pour chaque entité liée, le chemin société pivot → personne → entité. Les arêtes représentent des rôles publics, jamais automatiquement une participation au capital ou une relation familiale.",
    inputSchema: {
      siren: z.string(),
      max_people: z.number().int().min(1).max(25).default(10),
      max_companies_per_person: z.number().int().min(1).max(50).default(20),
    },
  },
  async ({ siren, max_people, max_companies_per_person }) =>
    result(
      await buildCompanyMandateGraph(siren, {
        maxPeople: max_people,
        maxCompaniesPerPerson: max_companies_per_person,
      }),
    ),
);

server.registerTool(
  "build_company_investigation_report",
  {
    title: "Construire un rapport d’enquête consolidé",
    description:
      "Orchestre les sources officielles autour d’un sujet pivot et exige un chemin de preuve pour chaque ramification. Il retourne identité, carte relationnelle, constats matériels documentés, SCI prioritaires, disponibilité financière, procédures, sanctions, couverture, contradictions, quality gates et menu d’approfondissement. Les liens tirés des actes peuvent être injectés comme chemins documentaires ; famille, détention, usufruit, représentation et transactions ne sont jamais inférés d’un nom ou d’une adresse.",
    inputSchema: {
      siren: z.string(),
      max_people: z.number().int().min(1).max(25).default(10),
      max_companies_per_person: z.number().int().min(1).max(50).default(50),
      external_observations: z
        .array(
          z.object({
            field: z.string().min(1),
            value: z.unknown(),
            source: z.string().min(1),
            observed_at: z.string().optional(),
            effective_at: z.string().optional(),
          }),
        )
        .max(200)
        .optional(),
      documentary_findings: z
        .array(
          z.object({
            id: z.string().min(1).optional(),
            title: z.string().min(1),
            category: z.enum([
              "document",
              "governance",
              "ownership",
              "transaction",
              "financial",
              "indexing",
              "other",
            ]),
            priority: z.enum(["high", "medium", "low"]),
            established_fact: z.string().min(1),
            why_it_matters: z.string().min(1),
            evidence: z
              .array(
                z.object({
                  level: z.enum([
                    "primary_document",
                    "official_metadata",
                    "corroborated_sources",
                    "external_observation",
                  ]),
                  source: z.string().min(1),
                  page: z.string().min(1).nullable(),
                  date: z.string().min(1).nullable(),
                  reference: z.string().min(1).optional(),
                }),
              )
              .min(1)
              .max(10),
            what_it_does_not_prove: z.array(z.string().min(1)).min(1).max(20),
            next_verification: z.array(z.string().min(1)).min(1).max(20),
            subject: relationshipEndpointSchema.optional(),
            relationship_path_ids: z.array(z.string().min(1)).max(20).optional(),
          }),
        )
        .max(100)
        .optional(),
      documentary_relationship_paths: z
        .array(
          z.object({
            id: z.string().min(1).optional(),
            target: relationshipEndpointSchema,
            priority: z.enum(["high", "medium", "low"]),
            analytical_relevance: z.string().min(1),
            steps: z.array(relationshipStepSchema).min(1).max(20),
            what_it_does_not_prove: z.array(z.string().min(1)).min(1).max(20),
          }),
        )
        .max(100)
        .optional(),
      economic_footprint: economicFootprintSchema.optional(),
    },
  },
  async ({
    siren,
    max_people,
    max_companies_per_person,
    external_observations,
    documentary_findings,
    documentary_relationship_paths,
    economic_footprint,
  }) =>
    result(
      await buildCompanyInvestigationReport(siren, {
        maxPeople: max_people,
        maxCompaniesPerPerson: max_companies_per_person,
        ...(external_observations
          ? {
              externalObservations: external_observations.map((item) => ({
                field: item.field,
                value: item.value,
                source: item.source,
                ...(item.observed_at ? { observedAt: item.observed_at } : {}),
                ...(item.effective_at ? { effectiveAt: item.effective_at } : {}),
              })),
            }
          : {}),
        ...(documentary_findings
          ? {
              documentaryFindings: documentary_findings.map((item) => ({
                ...(item.id ? { id: item.id } : {}),
                title: item.title,
                category: item.category,
                priority: item.priority,
                establishedFact: item.established_fact,
                whyItMatters: item.why_it_matters,
                evidence: item.evidence.map((evidence) => ({
                  level: evidence.level,
                  source: evidence.source,
                  page: evidence.page,
                  date: evidence.date,
                  ...(evidence.reference ? { reference: evidence.reference } : {}),
                })),
                whatItDoesNotProve: item.what_it_does_not_prove,
                nextVerification: item.next_verification,
                ...(item.subject ? { subject: relationshipEndpoint(item.subject) } : {}),
                ...(item.relationship_path_ids
                  ? { relationshipPathIds: item.relationship_path_ids }
                  : {}),
              })),
            }
          : {}),
        ...(documentary_relationship_paths
          ? {
              documentaryRelationshipPaths: documentary_relationship_paths.map((path) => ({
                ...(path.id ? { id: path.id } : {}),
                target: relationshipEndpoint(path.target),
                priority: path.priority,
                analyticalRelevance: path.analytical_relevance,
                steps: path.steps.map((step) => ({
                  from: relationshipEndpoint(step.from),
                  to: relationshipEndpoint(step.to),
                  relation: step.relation,
                  exactMechanism: step.exact_mechanism,
                  verificationStatus: step.verification_status,
                  temporalStatus: step.temporal_status,
                  confidence: step.confidence,
                  ...(step.effective_at !== undefined
                    ? { effectiveAt: step.effective_at }
                    : {}),
                  ...(step.ended_at !== undefined ? { endedAt: step.ended_at } : {}),
                  evidence: step.evidence.map(relationshipEvidence),
                  limitations: step.limitations,
                })),
                whatItDoesNotProve: path.what_it_does_not_prove,
              })),
            }
          : {}),
        ...(economic_footprint
          ? { economicFootprint: mapEconomicFootprintOptions(economic_footprint)! }
          : {}),
      }),
    ),
);

server.registerTool(
  "get_bodacc_history",
  {
    title: "Consulter l’historique BODACC",
    description:
      "Retourne les annonces BODACC récentes ou celles d’une famille précise, notamment les procédures collectives.",
    inputSchema: {
      siren: z.string(),
      family: z.enum(["collective", "creation", "modification", "radiation", "dpc"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    },
  },
  async ({ siren, family, limit }) =>
    result(
      await getBodaccHistory(siren, {
        ...(family ? { family } : {}),
        limit,
      }),
    ),
);

server.registerTool(
  "search_adlc_sanctions",
  {
    title: "Rechercher les sanctions financières AdlC",
    description:
      "Recherche gratuitement dans le jeu officiel des entreprises sanctionnées financièrement par l’Autorité de la concurrence depuis 2009.",
    inputSchema: { company_name: z.string().min(2) },
  },
  async ({ company_name }) => result(await searchAdlcSanctions(company_name)),
);

server.registerTool(
  "triage_company",
  {
    title: "Triage OSINT gratuit d’une entreprise",
    description:
      "Alias compatible du rapport consolidé : couverture tolérante aux pannes, ramifications, contradictions, quality gates et pistes d’approfondissement ; ne certifie jamais l’absence de risque.",
    inputSchema: { siren: z.string() },
  },
  async ({ siren }) => result(await triageCompany(siren)),
);

server.registerTool(
  "get_inpi_rne_record",
  {
    title: "Consulter la fiche officielle RNE",
    description:
      "Récupère l’état officiel courant d’une entreprise auprès de DATA INPI. Les coordonnées personnelles, adresses de personnes physiques et jours de naissance sont masqués par défaut.",
    inputSchema: { siren: z.string() },
  },
  async ({ siren }) => result(await getInpiCompany(siren)),
);

server.registerTool(
  "get_inpi_attachments",
  {
    title: "Lister les actes et comptes DATA INPI",
    description:
      "Liste les actes, statuts, comptes annuels publics et bilans structurés associés à un SIREN dans le RNE.",
    inputSchema: { siren: z.string() },
  },
  async ({ siren }) => result(await getInpiAttachments(siren)),
);

server.registerTool(
  "download_inpi_act_pdf",
  {
    title: "Télécharger un acte PDF officiel DATA INPI",
    description:
      "Télécharge dans le projet un acte ou des statuts publics à partir de l’identifiant renvoyé par get_inpi_attachments. Vérifie la signature PDF et renvoie le chemin local pour lecture avec un outil documentaire.",
    inputSchema: {
      act_id: z.string().min(5).max(200),
      output_directory: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe(
          "Dossier relatif à la racine du projet ; artifacts/inpi par défaut.",
        ),
    },
  },
  async ({ act_id, output_directory }) =>
    result(await downloadInpiActPdf(act_id, output_directory)),
);

server.registerTool(
  "download_inpi_balance_pdf",
  {
    title: "Télécharger des comptes annuels PDF officiels DATA INPI",
    description:
      "Télécharge dans le projet un bilan public à partir de l’identifiant bilans renvoyé par get_inpi_attachments. Refuse les comptes confidentiels, vérifie la signature PDF et renvoie le chemin local pour lecture avec un outil documentaire.",
    inputSchema: {
      balance_id: z.string().min(5).max(200),
      output_directory: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe(
          "Dossier relatif à la racine du projet ; artifacts/inpi par défaut.",
        ),
    },
  },
  async ({ balance_id, output_directory }) =>
    result(await downloadInpiBalancePdf(balance_id, output_directory)),
);

server.registerTool(
  "get_inpi_structured_balance",
  {
    title: "Lire un bilan structuré DATA INPI",
    description:
      "Récupère un bilan public structuré à partir de l’identifiant bilansSaisis renvoyé par get_inpi_attachments.",
    inputSchema: { balance_id: z.string().min(5).max(200) },
  },
  async ({ balance_id }) => result(await getInpiStructuredBalance(balance_id)),
);

server.registerTool(
  "search_judilibre",
  {
    title: "Rechercher dans Judilibre",
    description:
      "Recherche dans les décisions judiciaires ouvertes et pseudonymisées. Un résultat doit être qualifié selon le rôle de l’entreprise et ne constitue jamais un casier judiciaire.",
    inputSchema: {
      query: z.string().min(2),
      date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      jurisdictions: z.array(z.string()).max(20).optional(),
      fields: z.array(z.string()).max(20).optional(),
      types: z.array(z.string()).max(20).optional(),
      page: z.number().int().min(0).default(0),
      page_size: z.number().int().min(1).max(50).default(10),
      sort: z.enum(["score", "date"]).default("score"),
      order: z.enum(["asc", "desc"]).default("desc"),
    },
  },
  async ({
    query,
    date_start,
    date_end,
    jurisdictions,
    fields,
    types,
    page,
    page_size,
    sort,
    order,
  }) =>
    result(
      await searchJudilibre({
        query,
        ...(date_start ? { dateStart: date_start } : {}),
        ...(date_end ? { dateEnd: date_end } : {}),
        ...(jurisdictions ? { jurisdictions } : {}),
        ...(fields ? { fields } : {}),
        ...(types ? { types } : {}),
        page,
        pageSize: page_size,
        sort,
        order,
      }),
    ),
);

server.registerTool(
  "get_judilibre_decision",
  {
    title: "Lire une décision Judilibre",
    description:
      "Récupère le texte intégral pseudonymisé et les métadonnées d’une décision à partir de son identifiant Judilibre.",
    inputSchema: { decision_id: z.string().min(1).max(300) },
  },
  async ({ decision_id }) => result(await getJudilibreDecision(decision_id)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
