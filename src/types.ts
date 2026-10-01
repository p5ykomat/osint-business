export interface SourceRef {
  name: string;
  publisher: string;
  url: string;
  retrievedAt: string;
  status: "primary" | "aggregator" | "web-publication";
}

export interface EvidenceRef extends SourceRef {
  claim: string;
  confidence: "high" | "medium" | "low";
  limitations?: string[];
}

export interface GraphNode {
  id: string;
  type: "company" | "person";
  label: string;
  properties: Record<string, unknown>;
}

export type RelationshipKind =
  | "professional_mandate"
  | "corporate_representative"
  | "management"
  | "declared_associate"
  | "ownership_full"
  | "ownership_bare"
  | "usufruct"
  | "legal_representation"
  | "power_of_attorney"
  | "family_explicit"
  | "transaction"
  | "procedural_or_litigation"
  | "shared_address_context"
  | "other";

export type RelationshipVerificationStatus =
  | "verified"
  | "corroborated"
  | "candidate"
  | "contradicted";

export type RelationshipTemporalStatus = "current" | "historical" | "unknown";

export interface RelationshipEndpoint {
  id: string;
  type: "company" | "person" | "other_legal_entity";
  label: string;
  siren?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: RelationshipKind;
  properties: Record<string, unknown>;
  evidence: EvidenceRef;
}

export type CoverageStatus =
  | "complete"
  | "partial"
  | "failed"
  | "restricted"
  | "not_checked";

export interface CoverageCheck {
  id: string;
  source: string;
  purpose: string;
  status: CoverageStatus;
  queriedAt: string;
  returned?: number;
  total?: number;
  reason?: string;
  limitations?: string[];
  supportsNegativeConclusion: boolean;
}

export interface QualityGate {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  detail: string;
}

export interface InvestigationContradiction {
  id: string;
  kind:
    | "true_conflict"
    | "temporal_change"
    | "coverage_mismatch"
    | "unresolved";
  severity: "high" | "medium" | "information";
  category: "identity" | "coverage" | "financial" | "governance" | "chronology";
  summary: string;
  observations: Array<{
    source: string;
    value: unknown;
    observedAt?: string;
  }>;
  resolution: string;
}

export interface InvestigationLead {
  id: string;
  priority: "high" | "medium" | "low";
  category:
    | "linked_entity"
    | "ownership"
    | "financial"
    | "document"
    | "litigation"
    | "regulatory"
    | "reputation";
  title: string;
  rationale: string;
  relatedSiren?: string;
  relatedPerson?: string;
  anchorPathId?: string;
  nextChecks: string[];
}

export type MaterialFindingCategory =
  | "document"
  | "governance"
  | "ownership"
  | "transaction"
  | "financial"
  | "indexing"
  | "other";

export interface MaterialFindingEvidence {
  level:
    | "primary_document"
    | "official_metadata"
    | "corroborated_sources"
    | "external_observation";
  source: string;
  page: string | null;
  date: string | null;
  reference?: string;
}

export interface RelationshipPathStepInput {
  from: RelationshipEndpoint;
  to: RelationshipEndpoint;
  relation: RelationshipKind;
  exactMechanism: string;
  verificationStatus: RelationshipVerificationStatus;
  temporalStatus: RelationshipTemporalStatus;
  confidence: "high" | "medium" | "low";
  effectiveAt?: string | null;
  endedAt?: string | null;
  evidence: MaterialFindingEvidence[];
  limitations: string[];
}

export interface DocumentaryRelationshipPathInput {
  id?: string;
  target: RelationshipEndpoint;
  priority: "high" | "medium" | "low";
  analyticalRelevance: string;
  steps: RelationshipPathStepInput[];
  whatItDoesNotProve: string[];
}

export interface RelationshipPath extends Omit<DocumentaryRelationshipPathInput, "id"> {
  id: string;
  anchor: RelationshipEndpoint;
  source: "automated_mandate_graph" | "documentary_input";
  status: RelationshipVerificationStatus | "invalid";
  confidence: "high" | "medium" | "low";
  hopCount: number;
  summary: string;
  validationErrors: string[];
}

export interface DocumentaryFindingInput {
  id?: string;
  title: string;
  category: MaterialFindingCategory;
  priority: "high" | "medium" | "low";
  establishedFact: string;
  whyItMatters: string;
  evidence: MaterialFindingEvidence[];
  whatItDoesNotProve: string[];
  nextVerification: string[];
  subject?: RelationshipEndpoint;
  relationshipPathIds?: string[];
}

export interface MaterialFinding extends Omit<DocumentaryFindingInput, "id"> {
  id: string;
  origin: "document_reading" | "provided_observation" | "structural_deduction";
}

export interface ExplorationOption {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  whyNow: string;
  scope: string[];
  expectedOutputs: string[];
  limitations: string[];
  requiresAdditionalAuthorization: boolean;
  launchPrompt: string;
  anchorPathId?: string;
  triggeringGap?: string;
}
