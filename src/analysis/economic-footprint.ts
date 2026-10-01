import { normalizeText } from "../lib/normalize.js";
import type { PublicCompany, PublicDirector } from "../connectors/recherche-entreprises.js";
import type { MaterialFindingEvidence } from "../types.js";

export type EconomicEvidenceStatus =
  | "established"
  | "calculated"
  | "estimated"
  | "not_determinable";

export type EconomicMetricUnit = "EUR" | "percent" | "ratio";

export interface EconomicMetric {
  id: string;
  label: string;
  value: number | null;
  unit: EconomicMetricUnit;
  status: EconomicEvidenceStatus;
  exercise?: string;
  source: string;
  method?: string;
  evidence: MaterialFindingEvidence[];
  limitations: string[];
}

export interface SupplementalFinancialStatementInput {
  exercise: string;
  revenue?: number;
  netIncome?: number;
  ebitda?: number;
  cash?: number;
  financialDebt?: number;
  equity?: number;
  totalAssets?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  evidence: MaterialFindingEvidence[];
  limitations?: string[];
}

export interface EconomicPersonInput {
  name: string;
  relationshipPathId?: string;
}

export interface EconomicOwnershipInput {
  percentage: number;
  effectiveAt?: string;
  verificationStatus: "verified" | "corroborated";
  evidence: MaterialFindingEvidence[];
  limitations: string[];
  relationshipPathId?: string;
}

export type EconomicFlowCategory =
  | "mandate_compensation"
  | "employment_salary"
  | "dividend"
  | "company_distribution"
  | "shareholder_current_account_repayment"
  | "other";

export interface EconomicFlowInput {
  category: EconomicFlowCategory;
  amount: number;
  period: string;
  recipientScope: "person" | "company_total";
  evidence: MaterialFindingEvidence[];
  limitations: string[];
}

export interface ValuationAssumptionsInput {
  earningsMultipleLow?: number;
  earningsMultipleHigh?: number;
  netDebt?: number;
  rationale?: string;
  source?: string;
}

export interface EconomicFootprintOptions {
  subjectPerson?: EconomicPersonInput;
  supplementalStatements?: SupplementalFinancialStatementInput[];
  ownership?: EconomicOwnershipInput;
  flows?: EconomicFlowInput[];
  valuationAssumptions?: ValuationAssumptionsInput;
}

interface NormalizedExercise {
  exercise: string;
  revenue?: number;
  netIncome?: number;
  ebitda?: number;
  cash?: number;
  financialDebt?: number;
  equity?: number;
  totalAssets?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  evidence: MaterialFindingEvidence[];
  limitations: string[];
  source: string;
}

export interface EconomicHealthIndicator {
  id: string;
  label: string;
  status: EconomicEvidenceStatus;
  state: "favorable" | "mixed" | "unfavorable" | "neutral" | "not_determinable";
  value: number | null;
  unit?: EconomicMetricUnit;
  exercise?: string;
  explanation: string;
  method: string;
  limitations: string[];
}

const PUBLIC_FINANCE_SOURCE = "API Recherche d’Entreprises, synthèse de comptes publics";
const PUBLIC_FINANCE_URL = "https://recherche-entreprises.api.gouv.fr/docs/";
const VALUATION_METHOD_SOURCE =
  "Bpifrance Création, principales méthodes d’évaluation d’une entreprise";
const VALUATION_METHOD_URL =
  "https://bpifrance-creation.fr/moment-de-vie/quelles-sont-principales-methodes-devaluation-dune-entreprise";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function exerciseOrder(value: string): number {
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) ? year : Number.NEGATIVE_INFINITY;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle] ?? 0;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? current) + current) / 2
    : current;
}

function publicEvidence(exercise: string): MaterialFindingEvidence[] {
  return [{
    level: "official_metadata",
    source: PUBLIC_FINANCE_SOURCE,
    page: null,
    date: exercise,
    reference: PUBLIC_FINANCE_URL,
  }];
}

function normalizedExercises(
  company: PublicCompany,
  supplemental: SupplementalFinancialStatementInput[],
): NormalizedExercise[] {
  const exercises = new Map<string, NormalizedExercise>();
  for (const [exercise, values] of Object.entries(company.finances ?? {})) {
    exercises.set(exercise, {
      exercise,
      ...(finite(values.ca) ? { revenue: values.ca } : {}),
      ...(finite(values.resultat_net) ? { netIncome: values.resultat_net } : {}),
      evidence: publicEvidence(exercise),
      limitations: [
        "La synthèse publique ne remplace pas la lecture du bilan, du compte de résultat et de l’annexe.",
      ],
      source: PUBLIC_FINANCE_SOURCE,
    });
  }
  for (const statement of supplemental) {
    if (!statement.exercise.trim()) continue;
    if (statement.evidence.length === 0) {
      throw new Error(`L’exercice ${statement.exercise} doit comporter au moins une preuve.`);
    }
    const current = exercises.get(statement.exercise);
    exercises.set(statement.exercise, {
      exercise: statement.exercise,
      ...(current?.revenue !== undefined ? { revenue: current.revenue } : {}),
      ...(current?.netIncome !== undefined ? { netIncome: current.netIncome } : {}),
      ...(finite(statement.revenue) ? { revenue: statement.revenue } : {}),
      ...(finite(statement.netIncome) ? { netIncome: statement.netIncome } : {}),
      ...(finite(statement.ebitda) ? { ebitda: statement.ebitda } : {}),
      ...(finite(statement.cash) ? { cash: statement.cash } : {}),
      ...(finite(statement.financialDebt) ? { financialDebt: statement.financialDebt } : {}),
      ...(finite(statement.equity) ? { equity: statement.equity } : {}),
      ...(finite(statement.totalAssets) ? { totalAssets: statement.totalAssets } : {}),
      ...(finite(statement.currentAssets) ? { currentAssets: statement.currentAssets } : {}),
      ...(finite(statement.currentLiabilities) ? { currentLiabilities: statement.currentLiabilities } : {}),
      evidence: [...(current?.evidence ?? []), ...statement.evidence],
      limitations: [...(current?.limitations ?? []), ...(statement.limitations ?? [])],
      source: "Pièce financière lue et fournie à l’analyse",
    });
  }
  return [...exercises.values()].sort((a, b) => exerciseOrder(b.exercise) - exerciseOrder(a.exercise));
}

function metric(
  id: string,
  label: string,
  value: number,
  unit: EconomicMetricUnit,
  exercise: NormalizedExercise,
): EconomicMetric {
  return {
    id,
    label,
    value,
    unit,
    status: "established",
    exercise: exercise.exercise,
    source: exercise.source,
    evidence: exercise.evidence,
    limitations: exercise.limitations,
  };
}

function calculatedMetric(
  id: string,
  label: string,
  value: number,
  unit: EconomicMetricUnit,
  exercise: NormalizedExercise,
  method: string,
  limitations: string[],
): EconomicMetric {
  return {
    id,
    label,
    value: round(value),
    unit,
    status: "calculated",
    exercise: exercise.exercise,
    source: exercise.source,
    method,
    evidence: exercise.evidence,
    limitations: [...exercise.limitations, ...limitations],
  };
}

function exerciseMetrics(exercises: NormalizedExercise[]): Array<Record<string, unknown>> {
  return exercises.map((exercise, index) => {
    const previous = exercises[index + 1];
    const result: Record<string, unknown> = { exercise: exercise.exercise };
    if (finite(exercise.revenue)) {
      result.revenue = metric(
        `revenue:${exercise.exercise}`,
        "Chiffre d’affaires",
        exercise.revenue,
        "EUR",
        exercise,
      );
    }
    if (finite(exercise.netIncome)) {
      result.netIncome = metric(
        `net-income:${exercise.exercise}`,
        "Résultat net",
        exercise.netIncome,
        "EUR",
        exercise,
      );
    }
    if (finite(exercise.ebitda)) {
      result.ebitda = metric(`ebitda:${exercise.exercise}`, "EBITDA", exercise.ebitda, "EUR", exercise);
    }
    if (finite(exercise.revenue) && exercise.revenue !== 0 && finite(exercise.netIncome)) {
      result.netMargin = calculatedMetric(
        `net-margin:${exercise.exercise}`,
        "Marge nette",
        exercise.netIncome / exercise.revenue * 100,
        "percent",
        exercise,
        "résultat net ÷ chiffre d’affaires × 100",
        ["La marge nette doit être comparée à des entreprises de secteur et de modèle économique proches."],
      );
    }
    if (
      previous &&
      finite(exercise.revenue) &&
      finite(previous.revenue) &&
      previous.revenue !== 0
    ) {
      result.revenueGrowth = calculatedMetric(
        `revenue-growth:${exercise.exercise}`,
        "Évolution du chiffre d’affaires",
        (exercise.revenue - previous.revenue) / Math.abs(previous.revenue) * 100,
        "percent",
        exercise,
        `(${exercise.exercise} − ${previous.exercise}) ÷ |${previous.exercise}| × 100`,
        ["Une variation annuelle isolée ne suffit pas à établir une tendance durable."],
      );
    }
    for (const [key, label] of [
      ["cash", "Trésorerie"],
      ["financialDebt", "Dette financière"],
      ["equity", "Capitaux propres"],
      ["totalAssets", "Total de l’actif"],
      ["currentAssets", "Actif circulant"],
      ["currentLiabilities", "Passif exigible à court terme"],
    ] as const) {
      const value = exercise[key];
      if (finite(value)) result[key] = metric(`${key}:${exercise.exercise}`, label, value, "EUR", exercise);
    }
    if (finite(exercise.financialDebt) && finite(exercise.cash)) {
      result.netDebt = calculatedMetric(
        `net-debt:${exercise.exercise}`,
        "Dette financière nette",
        exercise.financialDebt - exercise.cash,
        "EUR",
        exercise,
        "dette financière − trésorerie",
        ["Le calcul n’intègre pas les engagements hors bilan ni les éléments assimilables à la dette."],
      );
    }
    if (finite(exercise.equity) && finite(exercise.totalAssets) && exercise.totalAssets !== 0) {
      result.equityRatio = calculatedMetric(
        `equity-ratio:${exercise.exercise}`,
        "Autonomie financière",
        exercise.equity / exercise.totalAssets * 100,
        "percent",
        exercise,
        "capitaux propres ÷ total de l’actif × 100",
        ["Ce ratio descriptif n’est pas une notation de crédit."],
      );
    }
    if (
      finite(exercise.currentAssets) &&
      finite(exercise.currentLiabilities) &&
      exercise.currentLiabilities !== 0
    ) {
      result.currentRatio = calculatedMetric(
        `current-ratio:${exercise.exercise}`,
        "Ratio de liquidité générale",
        exercise.currentAssets / exercise.currentLiabilities,
        "ratio",
        exercise,
        "actif circulant ÷ passif exigible à court terme",
        ["La composition et l’échéance réelles des postes doivent être lues dans les comptes."],
      );
    }
    return result;
  });
}

function healthIndicators(
  exercises: NormalizedExercise[],
  rows: Array<Record<string, unknown>>,
): EconomicHealthIndicator[] {
  const indicators: EconomicHealthIndicator[] = [];
  const latest = exercises[0];
  const latestRow = rows[0];
  if (!latest || !latestRow) {
    return [{
      id: "financial-data",
      label: "Comptes exploitables",
      status: "not_determinable",
      state: "not_determinable",
      value: null,
      explanation: "Aucun exercice chiffré exploitable n’est disponible dans les sources consultées.",
      method: "inventaire des exercices publics et des pièces financières lues",
      limitations: ["Une absence de chiffres publics ne prouve ni une mauvaise santé ni une absence d’activité."],
    }];
  }
  const margin = latestRow.netMargin as EconomicMetric | undefined;
  if (margin?.value !== null && margin?.value !== undefined) {
    const state = margin.value < 0
      ? "unfavorable"
      : margin.value < 3
        ? "mixed"
        : "favorable";
    indicators.push({
      id: "latest-profitability",
      label: "Rentabilité nette du dernier exercice",
      status: "calculated",
      state,
      value: margin.value,
      unit: "percent",
      exercise: latest.exercise,
      explanation: margin.value < 0
        ? "Le dernier exercice publié est déficitaire au niveau du résultat net."
        : margin.value < 3
          ? "Le dernier exercice est bénéficiaire, avec une marge nette étroite."
          : "Le dernier exercice est bénéficiaire avec une marge nette positive.",
      method: "résultat net ÷ chiffre d’affaires ; seuils descriptifs de 0 % et 3 %",
      limitations: [
        "Ces seuils sont des repères de lecture, pas des normes sectorielles ni une note de risque.",
      ],
    });
  }
  const growth = latestRow.revenueGrowth as EconomicMetric | undefined;
  if (growth?.value !== null && growth?.value !== undefined) {
    const state = growth.value > 5 ? "favorable" : growth.value < -5 ? "unfavorable" : "neutral";
    indicators.push({
      id: "latest-revenue-trend",
      label: "Tendance récente du chiffre d’affaires",
      status: "calculated",
      state,
      value: growth.value,
      unit: "percent",
      exercise: latest.exercise,
      explanation: growth.value > 5
        ? "Le chiffre d’affaires progresse de plus de 5 % sur le dernier intervalle publié."
        : growth.value < -5
          ? "Le chiffre d’affaires recule de plus de 5 % sur le dernier intervalle publié."
          : "Le chiffre d’affaires varie de moins de 5 % sur le dernier intervalle publié.",
      method: "variation entre les deux derniers exercices ; bande descriptive ±5 %",
      limitations: ["Deux exercices ne suffisent pas à isoler saisonnalité, inflation ou changement de périmètre."],
    });
  }
  const availableNetResults = exercises
    .filter((item) => finite(item.netIncome))
    .slice(0, 3)
    .map((item) => item.netIncome as number);
  if (availableNetResults.length >= 2) {
    const positiveCount = availableNetResults.filter((value) => value > 0).length;
    indicators.push({
      id: "profit-persistence",
      label: "Récurrence du bénéfice",
      status: "calculated",
      state: positiveCount === availableNetResults.length
        ? "favorable"
        : positiveCount === 0
          ? "unfavorable"
          : "mixed",
      value: positiveCount,
      unit: "ratio",
      explanation: `${positiveCount} exercice(s) bénéficiaire(s) sur ${availableNetResults.length} exercice(s) publiés analysés.`,
      method: "décompte des résultats nets strictement positifs sur les trois derniers exercices disponibles",
      limitations: ["La récurrence comptable ne prouve ni la trésorerie disponible ni la capacité de distribution."],
    });
  }
  const equityRatio = latestRow.equityRatio as EconomicMetric | undefined;
  if (equityRatio?.value !== null && equityRatio?.value !== undefined) {
    indicators.push({
      id: "equity-ratio",
      label: "Autonomie financière publiée",
      status: "calculated",
      state: equityRatio.value < 0 ? "unfavorable" : "neutral",
      value: equityRatio.value,
      unit: "percent",
      exercise: latest.exercise,
      explanation: equityRatio.value < 0
        ? "Les capitaux propres saisis sont négatifs relativement au total de l’actif."
        : "Le poids des capitaux propres est calculé sans comparaison sectorielle automatique.",
      method: equityRatio.method ?? "capitaux propres ÷ total de l’actif",
      limitations: equityRatio.limitations,
    });
  }
  return indicators.length > 0 ? indicators : [{
    id: "financial-data-limited",
    label: "Lecture financière limitée",
    status: "not_determinable",
    state: "not_determinable",
    value: null,
    explanation: "Un exercice existe, mais les postes disponibles ne permettent pas de calculer une marge ou une tendance.",
    method: "contrôle des postes disponibles",
    limitations: ["Lire les comptes complets et l’annexe avant toute conclusion de santé financière."],
  }];
}

function directorName(director: PublicDirector): string {
  return [director.prenoms, director.nom].filter(Boolean).join(" ");
}

function personRoles(company: PublicCompany, person?: EconomicPersonInput): string[] {
  if (!person) return [];
  const expected = normalizeText(person.name);
  return (company.dirigeants ?? [])
    .filter((director) => normalizeText(directorName(director)) === expected)
    .map((director) => director.qualite ?? "Mandat public sans qualité précisée");
}

function validateOptions(options: EconomicFootprintOptions): void {
  const hasDocumentarySupport = (evidence: MaterialFindingEvidence[]): boolean =>
    evidence.some((item) => item.level !== "external_observation");
  if (options.ownership) {
    if (!options.subjectPerson) {
      throw new Error("Une détention documentée doit être rattachée à subjectPerson.");
    }
    if (options.ownership.percentage < 0 || options.ownership.percentage > 100) {
      throw new Error("Le pourcentage de détention doit être compris entre 0 et 100.");
    }
    if (options.ownership.evidence.length === 0) {
      throw new Error("Une détention doit comporter au moins une preuve.");
    }
    if (!hasDocumentarySupport(options.ownership.evidence)) {
      throw new Error("Une détention ne peut pas être établie par une observation externe seule.");
    }
  }
  for (const statement of options.supplementalStatements ?? []) {
    if (!hasDocumentarySupport(statement.evidence)) {
      throw new Error(`L’exercice ${statement.exercise} exige une pièce ou une source corroborée.`);
    }
  }
  for (const flow of options.flows ?? []) {
    if (!finite(flow.amount) || flow.amount < 0) throw new Error("Chaque flux doit avoir un montant positif ou nul.");
    if (flow.evidence.length === 0) throw new Error("Chaque flux économique doit comporter au moins une preuve.");
    if (!hasDocumentarySupport(flow.evidence)) {
      throw new Error("Un flux personnel ne peut pas être établi par une observation externe seule.");
    }
  }
  const valuation = options.valuationAssumptions;
  if (valuation?.earningsMultipleLow !== undefined && valuation.earningsMultipleLow <= 0) {
    throw new Error("Le multiple bas doit être strictement positif.");
  }
  if (valuation?.earningsMultipleHigh !== undefined && valuation.earningsMultipleHigh <= 0) {
    throw new Error("Le multiple haut doit être strictement positif.");
  }
  if (
    valuation?.earningsMultipleLow !== undefined &&
    valuation.earningsMultipleHigh !== undefined &&
    valuation.earningsMultipleLow > valuation.earningsMultipleHigh
  ) {
    throw new Error("Le multiple bas ne peut pas dépasser le multiple haut.");
  }
}

export function buildEconomicFootprint(
  company: PublicCompany,
  options: EconomicFootprintOptions = {},
): Record<string, unknown> {
  validateOptions(options);
  const exercises = normalizedExercises(company, options.supplementalStatements ?? []);
  const rows = exerciseMetrics(exercises);
  const indicators = healthIndicators(exercises, rows);
  const availableNetResults = exercises
    .filter((item) => finite(item.netIncome))
    .slice(0, 3)
    .map((item) => item.netIncome as number);
  const normalizedEarnings = availableNetResults.length >= 2 ? median(availableNetResults) : null;
  const lowMultiple = options.valuationAssumptions?.earningsMultipleLow ?? 3;
  const highMultiple = options.valuationAssumptions?.earningsMultipleHigh ?? 6;
  const usableEarnings = normalizedEarnings !== null && normalizedEarnings > 0;
  const enterpriseLow = usableEarnings ? round(normalizedEarnings * lowMultiple) : null;
  const enterpriseHigh = usableEarnings ? round(normalizedEarnings * highMultiple) : null;
  const latest = exercises[0];
  const inferredNetDebt = latest && finite(latest.financialDebt) && finite(latest.cash)
    ? latest.financialDebt - latest.cash
    : undefined;
  const netDebt = options.valuationAssumptions?.netDebt ?? inferredNetDebt;
  const equityLow = enterpriseLow !== null && finite(netDebt) ? round(enterpriseLow - netDebt) : null;
  const equityHigh = enterpriseHigh !== null && finite(netDebt) ? round(enterpriseHigh - netDebt) : null;
  const ownership = options.ownership;
  const equityExposure = ownership && equityLow !== null && equityHigh !== null
    ? {
        status: "estimated" as const,
        low: round(equityLow * ownership.percentage / 100),
        high: round(equityHigh * ownership.percentage / 100),
        currency: "EUR",
        method: `fourchette de valeur des capitaux propres × ${ownership.percentage} %`,
        limitations: [
          ...ownership.limitations,
          "Cette exposition théorique n’est ni un patrimoine net, ni une valeur de cession garantie, ni une somme liquide.",
        ],
      }
    : {
        status: "not_determinable" as const,
        low: null,
        high: null,
        currency: "EUR",
        method: "exige une détention datée et une valeur des capitaux propres, donc une dette nette documentée",
        limitations: [
          "Un mandat de direction ne prouve aucune participation au capital.",
          "La valeur d’entreprise ne peut pas être attribuée personnellement sans détention démontrée.",
        ],
      };
  const flows = (options.flows ?? []).map((flow, index) => ({
    id: `documented-flow:${index + 1}`,
    ...flow,
    status: "established" as const,
    attribution: flow.recipientScope === "person"
      ? "Montant attribué à la personne par la preuve fournie."
      : "Montant constaté au niveau de la société ; il n’est pas attribué à la personne.",
  }));
  const personalFlows = flows.filter((flow) => flow.recipientScope === "person");
  const remunerationFlows = personalFlows.filter((flow) =>
    flow.category === "mandate_compensation" || flow.category === "employment_salary");
  const roles = personRoles(company, options.subjectPerson);

  return {
    schemaVersion: "1.0.0",
    labels: {
      established: "Montant ou fait directement publié ou lu dans une pièce.",
      calculated: "Résultat arithmétique reproductible à partir de données établies.",
      estimated: "Fourchette dépendant d’hypothèses explicites ; ce n’est pas un fait publié.",
      not_determinable: "Les sources consultées ne permettent pas de conclure.",
    },
    company: {
      siren: company.siren,
      name: company.nom_complet,
    },
    financialHistory: rows,
    health: {
      status: exercises.length === 0 ? "not_determinable" : exercises.length === 1 ? "limited" : "analyzable",
      indicators,
      conclusion:
        "Les indicateurs décrivent les comptes disponibles sans produire de score opaque ni de diagnostic de solvabilité.",
      warning:
        "Le bénéfice comptable n’est ni la trésorerie disponible, ni un dividende, ni le revenu d’une personne.",
    },
    valuation: {
      status: usableEarnings ? "estimated" : "not_determinable",
      scenarios: usableEarnings
        ? [{
            id: "normalized-net-income-multiple",
            status: "estimated",
            method: "capitalisation du résultat net normalisé",
            normalizedEarnings: round(normalizedEarnings),
            normalizedEarningsMethod:
              `médiane des ${availableNetResults.length} derniers résultats nets disponibles, pertes comprises`,
            assumptions: {
              earningsMultipleLow: lowMultiple,
              earningsMultipleHigh: highMultiple,
              assumptionsOrigin: options.valuationAssumptions
                ? "hypothèses fournies pour le dossier"
                : "scénario illustratif automatique non sectoriel",
              rationale: options.valuationAssumptions?.rationale
                ?? "Le scénario automatique sert à tester une plage, pas à annoncer une valeur de marché.",
              source: options.valuationAssumptions?.source ?? VALUATION_METHOD_SOURCE,
            },
            enterpriseValueRange: { low: enterpriseLow, high: enterpriseHigh, currency: "EUR" },
            equityValueRange: finite(netDebt)
              ? { low: equityLow, high: equityHigh, currency: "EUR", netDebt: round(netDebt) }
              : {
                  low: null,
                  high: null,
                  currency: "EUR",
                  netDebt: null,
                  status: "not_determinable",
                  reason: "La dette financière nette n’est pas documentée.",
                },
            confidence: options.valuationAssumptions && finite(netDebt) ? "medium" : "low",
            limitations: [
              "La valeur n’est pas le prix de cession.",
              "Une évaluation sérieuse croise approches patrimoniale, comparative et de rentabilité.",
              options.valuationAssumptions
                ? "Les multiples fournis doivent être justifiés par le secteur, la taille, le risque et des comparables datés."
                : "Les multiples automatiques de 3× à 6× ne sont pas calibrés au secteur lorsqu’aucune hypothèse n’est fournie.",
              "Éléments exceptionnels, besoin en fonds de roulement, dépendance au dirigeant et engagements hors bilan ne sont pas retraités automatiquement.",
            ],
          }]
        : [],
      methodologySource: { name: VALUATION_METHOD_SOURCE, url: VALUATION_METHOD_URL },
      disclaimer:
        "Toute fourchette affichée est un scénario analytique, pas une expertise, une offre ni une valeur patrimoniale personnelle.",
      notDeterminableReason: usableEarnings
        ? null
        : "Il faut au moins deux résultats nets publiés et un résultat normalisé positif pour générer le scénario automatique.",
    },
    personFootprint: {
      person: options.subjectPerson?.name ?? null,
      relationshipPathId: options.subjectPerson?.relationshipPathId ?? ownership?.relationshipPathId ?? null,
      publicRoles: roles,
      roleStatus: roles.length > 0 ? "established" : "not_determinable",
      ownership: ownership
        ? { ...ownership, status: "established" }
        : {
            status: "not_determinable",
            percentage: null,
            reason: "Aucune détention datée et prouvée n’a été fournie.",
          },
      documentedFlows: flows,
      remuneration: remunerationFlows.length > 0
        ? {
            status: "established",
            records: remunerationFlows,
            warning: "Les montants documentés ne prouvent pas l’exhaustivité des revenus de la personne.",
          }
        : {
            status: "not_determinable",
            records: [],
            reason: "Le mandat public et les comptes de la société ne publient pas automatiquement la rémunération individuelle.",
          },
      distributions: flows.filter((flow) =>
        flow.category === "dividend" || flow.category === "company_distribution"),
      equityExposureScenario: equityExposure,
      netWorth: {
        status: "not_determinable",
        reason:
          "Le patrimoine personnel complet, les dettes privées, les autres actifs et les données fiscales ne sont pas déterminables à partir des registres d’entreprise.",
      },
      warning:
        "Mandat, rémunération, dividende, détention et patrimoine sont cinq notions distinctes ; aucune n’est déduite d’une autre.",
    },
    methodology: {
      rule: "établi → calculé → estimé → non déterminable",
      zeroCost: true,
      automaticScore: false,
      sources: [
        { name: PUBLIC_FINANCE_SOURCE, url: PUBLIC_FINANCE_URL },
        { name: VALUATION_METHOD_SOURCE, url: VALUATION_METHOD_URL },
      ],
      privacyBoundary:
        "Le module documente l’exposition économique démontrable ; il ne reconstitue ni revenu fiscal ni patrimoine privé.",
    },
  };
}
