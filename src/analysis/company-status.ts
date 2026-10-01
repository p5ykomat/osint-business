import type { PublicCompany } from "../connectors/recherche-entreprises.js";

export type ReconciledCompanyStatus = "active" | "ceased" | "uncertain";

export interface CompanyStatusAssessment {
  status: ReconciledCompanyStatus;
  effectiveDate?: string;
  basis: Array<{
    source: "API Recherche d’Entreprises" | "RNE / DATA INPI";
    field: string;
    value: unknown;
  }>;
  conflicts: string[];
  limitations: string[];
}

interface LeafValue {
  path: string;
  value: unknown;
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function leaves(value: unknown, path: string[] = []): LeafValue[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => leaves(child, [...path, String(index)]));
  }
  if (!value || typeof value !== "object") {
    return [{ path: path.map(normalizeKey).join("."), value }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, [...path, key]),
  );
}

function dateValues(items: LeafValue[]): string[] {
  return items
    .map((item) => (typeof item.value === "string" ? item.value.slice(0, 10) : undefined))
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)))
    .sort();
}

export function assessCompanyOperatingStatus(
  company: PublicCompany,
  inpiRecord?: unknown,
): CompanyStatusAssessment {
  const basis: CompanyStatusAssessment["basis"] = [];
  const conflicts: string[] = [];
  const rneLeaves = leaves(inpiRecord);
  const totalCessation = rneLeaves.filter((item) =>
    /detailcessationentreprise\.(datecessationtotaleactivite|dateradiation|dateeffet)$/.test(
      item.path,
    ),
  );
  const rneCessationDates = dateValues(totalCessation);
  const companyClosed = company.etat_administratif === "C" || Boolean(company.date_fermeture);
  const companyActive = company.etat_administratif === "A" && !company.date_fermeture;

  if (company.etat_administratif) {
    basis.push({
      source: "API Recherche d’Entreprises",
      field: "etat_administratif",
      value: company.etat_administratif,
    });
  }
  if (company.date_fermeture) {
    basis.push({
      source: "API Recherche d’Entreprises",
      field: "date_fermeture",
      value: company.date_fermeture,
    });
  }
  for (const item of totalCessation) {
    basis.push({ source: "RNE / DATA INPI", field: item.path, value: item.value });
  }

  if (rneCessationDates.length > 0 || companyClosed) {
    if (companyActive) {
      conflicts.push(
        "L’état agrégé paraît actif alors que le RNE contient une cessation totale ou une radiation datée.",
      );
    }
    const effectiveDate = rneCessationDates.at(-1) ?? company.date_fermeture ?? undefined;
    return {
      status: "ceased",
      ...(effectiveDate ? { effectiveDate } : {}),
      basis,
      conflicts,
      limitations: [
        "Une cessation n’exclut pas une reprise ultérieure : rechercher une réactivation du SIREN et tout nouveau SIRET après la date d’effet.",
        "L’inscription RCS/RNE, l’état de l’unité légale et l’état de chaque établissement doivent rester distincts.",
      ],
    };
  }

  if (companyActive) {
    return {
      status: "active",
      basis,
      conflicts,
      limitations: [
        "Le statut actif décrit l’état administratif diffusé à la date de collecte, pas l’existence d’un chiffre d’affaires ni d’une activité économique effective.",
      ],
    };
  }

  return {
    status: "uncertain",
    basis,
    conflicts,
    limitations: [
      "Aucun état courant suffisamment explicite n’a été obtenu ; interroger le RNE, Sirene et les formalités datées avant de conclure.",
    ],
  };
}
