import { normalizeText } from "../lib/normalize.js";
import type { InvestigationContradiction } from "../types.js";

export interface FactObservation {
  field: string;
  value: unknown;
  source: string;
  observedAt?: string;
  effectiveAt?: string;
}

function normalizedValue(value: unknown): string {
  if (typeof value === "string") return normalizeText(value).replace(/\s+/g, "");
  if (Array.isArray(value)) return JSON.stringify(value.map(normalizedValue).sort());
  if (value && typeof value === "object") {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalizedValue(child)]),
      ),
    );
  }
  return JSON.stringify(value);
}

function categoryFor(field: string): InvestigationContradiction["category"] {
  if (/capital|finance|compte|resultat|chiffre/i.test(field)) return "financial";
  if (/dirigeant|gerant|mandat|associe/i.test(field)) return "governance";
  if (/date|creation|publication|effet/i.test(field)) return "chronology";
  if (/acte|document|piece|count|nombre|graph|linked|ramification/i.test(field)) return "coverage";
  return "identity";
}

export function reconcileObservations(
  observations: FactObservation[],
): InvestigationContradiction[] {
  const grouped = new Map<string, FactObservation[]>();
  for (const observation of observations) {
    const group = grouped.get(observation.field) ?? [];
    group.push(observation);
    grouped.set(observation.field, group);
  }

  const contradictions: InvestigationContradiction[] = [];
  for (const [field, values] of grouped) {
    const distinct = new Set(values.map((item) => normalizedValue(item.value)));
    if (distinct.size <= 1) continue;

    const effectiveDates = new Set(values.map((item) => item.effectiveAt).filter(Boolean));
    const numericValues = values
      .map((item) => (typeof item.value === "number" ? item.value : undefined))
      .filter((item): item is number => item !== undefined);
    const looksLikeCoverageCount = /act|document|piece|count|nombre/i.test(field);
    const arraySizes = values
      .map((item) => (Array.isArray(item.value) ? item.value.length : undefined))
      .filter((item): item is number => item !== undefined);
    const coverageMismatch =
      (looksLikeCoverageCount &&
        numericValues.length === values.length &&
        numericValues.includes(0) &&
        numericValues.some((item) => item > 0)) ||
      (/graph|linked|ramification/i.test(field) &&
        arraySizes.length === values.length &&
        arraySizes.includes(0) &&
        arraySizes.some((item) => item > 0));
    const temporalChange = effectiveDates.size > 1;
    const kind: InvestigationContradiction["kind"] = coverageMismatch
      ? "coverage_mismatch"
      : temporalChange
        ? "temporal_change"
        : "unresolved";

    contradictions.push({
      id: `contradiction:${field}`,
      kind,
      severity: coverageMismatch || !temporalChange ? "medium" : "information",
      category: categoryFor(field),
      summary: coverageMismatch
        ? `Les sources ne couvrent pas le même nombre d’éléments pour « ${field} ».`
        : temporalChange
          ? `Les valeurs de « ${field} » peuvent correspondre à des périodes d’effet différentes.`
          : `Les sources divergent sur « ${field} » sans explication temporelle établie.`,
      observations: values.map((item) => ({
        source: item.source,
        value: item.value,
        ...(item.observedAt ? { observedAt: item.observedAt } : {}),
      })),
      resolution: coverageMismatch
        ? "Conserver la source la plus directe pour l’existence des éléments et signaler la lacune d’indexation de l’autre source."
        : temporalChange
          ? "Ordonner les valeurs par date d’effet avant de sélectionner la valeur courante."
          : "Ne pas fusionner silencieusement ; rechercher une pièce primaire ou conserver l’incertitude.",
    });
  }
  return contradictions;
}
