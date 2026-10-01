import { buildCompanyInvestigationReport } from "./report.js";

/**
 * Point d’entrée conservé pour les clients du MVP. L’ancien triage échouait
 * entièrement dès qu’une source était indisponible. Il délègue désormais au
 * rapport consolidé tolérant aux pannes, afin d’unifier couverture,
 * contradictions, ramifications et pistes d’approfondissement.
 */
export async function triageCompany(value: string): Promise<Record<string, unknown>> {
  const report = await buildCompanyInvestigationReport(value);
  return {
    ...report,
    outputMode: "triage-compatible",
  };
}
