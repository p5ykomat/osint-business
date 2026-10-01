import { normalizeText } from "../lib/normalize.js";
import type {
  DocumentaryRelationshipPathInput,
  RelationshipEndpoint,
  RelationshipPath,
  RelationshipVerificationStatus,
} from "../types.js";

export interface RelationalSynthesis {
  anchor: RelationshipEndpoint;
  primaryPaths: RelationshipPath[];
  alternativePaths: RelationshipPath[];
  candidatePaths: RelationshipPath[];
  contradictedPaths: RelationshipPath[];
  orphanPaths: RelationshipPath[];
  rule: string;
}

function endpointKey(endpoint: RelationshipEndpoint): string {
  if (endpoint.type === "company" && endpoint.siren) return `company:${endpoint.siren}`;
  return `${endpoint.type}:${normalizeText(endpoint.id || endpoint.label).toLowerCase()}`;
}

function pathId(input: DocumentaryRelationshipPathInput, index: number): string {
  if (input.id) return input.id;
  const slug = normalizeText(input.target.label).toLowerCase().replace(/\s+/g, "-").slice(0, 64);
  return `documentary-path:${slug || "target"}:${index + 1}`;
}

function weakestConfidence(
  steps: DocumentaryRelationshipPathInput["steps"],
): "high" | "medium" | "low" {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return steps.reduce<"high" | "medium" | "low">(
    (weakest, step) => (rank[step.confidence] < rank[weakest] ? step.confidence : weakest),
    "high",
  );
}

function aggregateStatus(
  steps: DocumentaryRelationshipPathInput["steps"],
): RelationshipVerificationStatus {
  if (steps.some((step) => step.verificationStatus === "contradicted")) return "contradicted";
  if (steps.some((step) => step.verificationStatus === "candidate")) return "candidate";
  if (steps.some((step) => step.verificationStatus === "corroborated")) return "corroborated";
  return "verified";
}

function pathSummary(input: DocumentaryRelationshipPathInput): string {
  if (input.steps.length === 0) return input.target.label;
  return input.steps
    .map((step, index) =>
      index === 0
        ? `${step.from.label} [${step.exactMechanism}]→ ${step.to.label}`
        : `[${step.exactMechanism}]→ ${step.to.label}`,
    )
    .join(" ");
}

export function normalizeDocumentaryRelationshipPaths(
  inputs: DocumentaryRelationshipPathInput[],
  anchor: RelationshipEndpoint,
): RelationshipPath[] {
  return inputs.map((input, index) => {
    const validationErrors: string[] = [];
    const first = input.steps[0];
    const last = input.steps[input.steps.length - 1];

    if (!first) {
      validationErrors.push("Le chemin ne contient aucun maillon.");
    } else if (endpointKey(first.from) !== endpointKey(anchor)) {
      validationErrors.push("Le premier maillon ne part pas du sujet pivot.");
    }

    for (let stepIndex = 0; stepIndex < input.steps.length; stepIndex += 1) {
      const step = input.steps[stepIndex];
      if (!step) continue;
      if (step.evidence.length === 0) {
        validationErrors.push(`Le maillon ${stepIndex + 1} ne contient aucune preuve.`);
      }
      if (
        step.relation === "shared_address_context" &&
        step.verificationStatus !== "candidate"
      ) {
        validationErrors.push(
          `Le maillon ${stepIndex + 1} repose sur une adresse commune et doit rester candidat.`,
        );
      }
      if (
        step.relation === "family_explicit" &&
        step.verificationStatus !== "candidate" &&
        !step.evidence.some((evidence) =>
          ["primary_document", "corroborated_sources"].includes(evidence.level),
        )
      ) {
        validationErrors.push(
          `Le maillon familial ${stepIndex + 1} n'est pas étayé par une pièce primaire ou des sources corroborées.`,
        );
      }
      if (stepIndex > 0) {
        const previous = input.steps[stepIndex - 1];
        if (previous && endpointKey(previous.to) !== endpointKey(step.from)) {
          validationErrors.push(`Rupture de continuité entre les maillons ${stepIndex} et ${stepIndex + 1}.`);
        }
      }
    }

    if (last && endpointKey(last.to) !== endpointKey(input.target)) {
      validationErrors.push("La cible déclarée ne correspond pas à la fin du chemin.");
    }

    const status = validationErrors.length > 0 ? "invalid" : aggregateStatus(input.steps);
    return {
      id: pathId(input, index),
      anchor: { ...anchor },
      target: { ...input.target },
      priority: input.priority,
      analyticalRelevance: input.analyticalRelevance,
      steps: input.steps.map((step) => ({
        ...step,
        from: { ...step.from },
        to: { ...step.to },
        evidence: step.evidence.map((evidence) => ({ ...evidence })),
        limitations: [...step.limitations],
      })),
      whatItDoesNotProve: [...input.whatItDoesNotProve],
      source: "documentary_input",
      status,
      confidence: weakestConfidence(input.steps),
      hopCount: input.steps.length,
      summary: pathSummary(input),
      validationErrors,
    };
  });
}

function preferredPathOrder(left: RelationshipPath, right: RelationshipPath): number {
  const confidence = { high: 0, medium: 1, low: 2 } as const;
  const verification = { verified: 0, corroborated: 1 } as const;
  return (
    left.hopCount - right.hopCount ||
    confidence[left.confidence] - confidence[right.confidence] ||
    verification[left.status as "verified" | "corroborated"] -
      verification[right.status as "verified" | "corroborated"] ||
    left.id.localeCompare(right.id)
  );
}

export function buildRelationalSynthesis(
  anchor: RelationshipEndpoint,
  automaticPaths: RelationshipPath[],
  documentaryInputs: DocumentaryRelationshipPathInput[],
): RelationalSynthesis {
  const documentaryPaths = normalizeDocumentaryRelationshipPaths(documentaryInputs, anchor);
  const allPaths = [...automaticPaths, ...documentaryPaths];
  const verified = allPaths
    .filter((path) => path.status === "verified" || path.status === "corroborated")
    .sort(preferredPathOrder);
  const primaryPaths: RelationshipPath[] = [];
  const alternativePaths: RelationshipPath[] = [];
  const seenTargets = new Set<string>();

  for (const path of verified) {
    const key = endpointKey(path.target);
    if (seenTargets.has(key)) alternativePaths.push(path);
    else {
      primaryPaths.push(path);
      seenTargets.add(key);
    }
  }

  return {
    anchor,
    primaryPaths,
    alternativePaths,
    candidatePaths: allPaths.filter((path) => path.status === "candidate"),
    contradictedPaths: allPaths.filter((path) => path.status === "contradicted"),
    orphanPaths: allPaths.filter((path) => path.status === "invalid"),
    rule:
      "Le corps du rapport ne conserve une entité secondaire que si un chemin au pivot est vérifié ou corroboré. Les candidats, contradictions et faits sans chemin sont séparés.",
  };
}

export function endpointMatches(left: RelationshipEndpoint, right: RelationshipEndpoint): boolean {
  return endpointKey(left) === endpointKey(right);
}
