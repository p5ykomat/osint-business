import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { request, requestJson } from "../lib/http.js";
import { assertSiren } from "../lib/normalize.js";
import type { SourceRef } from "../types.js";

const API_BASE = "https://registre-national-entreprises.inpi.fr/api";
const DEFAULT_TOKEN_LIFETIME_MS = 30 * 60 * 1000;

interface InpiLoginResponse {
  token: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | undefined;

function requiredEnvironment(name: "INPI_USERNAME" | "INPI_PASSWORD"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} absent. Complétez votre fichier .env personnel selon docs/ACCES.md, puis reconnectez le serveur MCP.`,
    );
  }
  return value;
}

function jwtExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 - 60_000 : undefined;
  } catch {
    return undefined;
  }
}

async function inpiToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const login = await requestJson<InpiLoginResponse>(
    `${API_BASE}/sso/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: requiredEnvironment("INPI_USERNAME"),
        password: requiredEnvironment("INPI_PASSWORD"),
      }),
    },
    30_000,
  );
  if (!login.token) throw new Error("L’INPI n’a pas renvoyé de jeton d’authentification.");

  tokenCache = {
    token: login.token,
    expiresAt: jwtExpiry(login.token) ?? Date.now() + DEFAULT_TOKEN_LIFETIME_MS,
  };
  return login.token;
}

async function inpiGet<T>(path: string): Promise<T> {
  const token = await inpiToken();
  return requestJson<T>(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function inpiGetBinary(path: string): Promise<{
  bytes: Buffer;
  contentType: string | null;
}> {
  const token = await inpiToken();
  const response = await request(
    `${API_BASE}${path}`,
    {
      headers: {
        Accept: "application/pdf, application/octet-stream;q=0.9",
        Authorization: `Bearer ${token}`,
      },
    },
    60_000,
  );
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

function normalizedKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function birthMonth(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : value;
}

export function sanitizeInpiPublicData(value: unknown, path: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInpiPublicData(item, path));
  }
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    const fullPath = [...path, normalized].join(".");

    if (/password|motdepasse|token|secret/.test(normalized)) continue;
    if (/beneficiaire.?effectif/.test(fullPath)) {
      sanitized[key] = "[non restitué : accès et finalité à vérifier]";
      continue;
    }
    if (/date.*naissance|naissance.*date/.test(normalized)) {
      sanitized[key] = birthMonth(child);
      continue;
    }
    if (/lieu.*naissance/.test(normalized)) continue;
    if (/email|courriel|telephone|phone|mobile/.test(normalized)) {
      sanitized[key] = "[masqué]";
      continue;
    }
    if (
      /(personnephysique|entrepreneur)/.test(fullPath) &&
      /(adresse|domicile|residence)/.test(normalized)
    ) {
      sanitized[key] = "[adresse personnelle non restituée]";
      continue;
    }

    sanitized[key] = sanitizeInpiPublicData(child, [...path, normalized]);
  }
  return sanitized;
}

export function inpiSource(): SourceRef {
  return {
    name: "Registre national des entreprises, API DATA INPI",
    publisher: "Institut national de la propriété industrielle",
    url: "https://data.inpi.fr/content/editorial/Acces_API_Entreprises",
    retrievedAt: new Date().toISOString(),
    status: "primary",
  };
}

export async function getInpiCompany(value: string): Promise<{
  siren: string;
  record: unknown;
  source: SourceRef;
  privacy: string[];
}> {
  const siren = assertSiren(value);
  const record = await inpiGet<unknown>(`/companies/${siren}`);
  return {
    siren,
    record: sanitizeInpiPublicData(record),
    source: inpiSource(),
    privacy: [
      "Les jours de naissance sont supprimés ; seul le mois et l’année peuvent être conservés.",
      "Les coordonnées directes et adresses rattachées à une personne physique sont masquées par défaut.",
      "Les données de bénéficiaires effectifs ne sont pas restituées par cet outil sans examen de la base légale.",
    ],
  };
}

export async function getInpiAttachments(value: string): Promise<{
  siren: string;
  attachments: unknown;
  source: SourceRef;
  limitations: string[];
}> {
  const siren = assertSiren(value);
  const attachments = await inpiGet<unknown>(`/companies/${siren}/attachments`);
  return {
    siren,
    attachments: sanitizeInpiPublicData(attachments),
    source: inpiSource(),
    limitations: [
      "Les comptes confidentiels ne sont pas accessibles.",
      "La présence d’un acte ou d’un compte doit être interprétée selon sa date de dépôt et sa date d’effet.",
    ],
  };
}

export function assertInpiDocumentId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9._:-]{5,200}$/.test(id)) {
    throw new Error("Identifiant de document INPI invalide.");
  }
  return id;
}

export function safeInpiOutputDirectory(value?: string): string {
  const projectRoot = resolve(process.cwd());
  const requested = value?.trim() || "artifacts/inpi";
  if (isAbsolute(requested)) {
    throw new Error(
      "Le dossier de sortie INPI doit être relatif à la racine du projet.",
    );
  }
  const outputDirectory = resolve(projectRoot, requested);
  const rel = relative(projectRoot, outputDirectory);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Le dossier de sortie INPI doit rester dans le projet courant.");
  }
  return outputDirectory;
}

function metadataString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataBoolean(metadata: unknown, key: string): boolean | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

export function assertInpiPdf(bytes: Buffer, contentType: string | null): void {
  const signature = bytes.subarray(0, 5).toString("ascii");
  if (signature !== "%PDF-") {
    throw new Error(
      `L’INPI n’a pas renvoyé un PDF valide (type reçu : ${contentType ?? "inconnu"}).`,
    );
  }
}

export async function downloadInpiActPdf(
  value: string,
  outputDirectory?: string,
): Promise<{
  actId: string;
  siren: string | null;
  dateDepot: string | null;
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
  metadata: unknown;
  source: SourceRef;
  limitations: string[];
}> {
  const actId = assertInpiDocumentId(value);
  const encodedId = encodeURIComponent(actId);
  const metadata = await inpiGet<unknown>(`/actes/${encodedId}`);
  const confidentiality = metadataString(metadata, "confidentiality");
  const deleted = metadataBoolean(metadata, "deleted");

  if (deleted) {
    throw new Error("Cet acte INPI est signalé comme supprimé et ne doit pas être conservé.");
  }
  if (confidentiality && normalizedKey(confidentiality) !== "public") {
    throw new Error(`Cet acte INPI n’est pas public (${confidentiality}).`);
  }

  const { bytes, contentType } = await inpiGetBinary(`/actes/${encodedId}/download`);
  assertInpiPdf(bytes, contentType);

  const siren = metadataString(metadata, "siren");
  const dateDepot = metadataString(metadata, "dateDepot");
  const safeSiren = siren && /^\d{9}$/.test(siren) ? siren : "document";
  const safeDate = dateDepot && /^\d{4}-\d{2}-\d{2}$/.test(dateDepot)
    ? dateDepot
    : "date-inconnue";
  const directory = safeInpiOutputDirectory(outputDirectory);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${safeSiren}_${safeDate}_${actId}.pdf`);

  try {
    await writeFile(path, bytes, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const existing = await readFile(path);
    assertInpiPdf(existing, "application/pdf");
    if (!existing.equals(bytes)) {
      throw new Error(
        "Un fichier différent existe déjà pour cet identifiant INPI ; aucun écrasement n’a été effectué.",
      );
    }
  }

  return {
    actId,
    siren: siren ?? null,
    dateDepot: dateDepot ?? null,
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType,
    metadata: sanitizeInpiPublicData(metadata),
    source: inpiSource(),
    limitations: [
      "Le fichier est une copie du document public diffusé par DATA INPI ; son contenu doit encore être lu et vérifié.",
      "Ne restituez pas les adresses résidentielles ni les dates de naissance précises éventuellement présentes dans l’acte.",
      "Un acte supprimé ou non public n’est pas téléchargé.",
    ],
  };
}

export async function downloadInpiBalancePdf(
  value: string,
  outputDirectory?: string,
): Promise<{
  balanceId: string;
  siren: string | null;
  dateDepot: string | null;
  dateCloture: string | null;
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
  metadata: unknown;
  source: SourceRef;
  limitations: string[];
}> {
  const balanceId = assertInpiDocumentId(value);
  const encodedId = encodeURIComponent(balanceId);
  const metadata = await inpiGet<unknown>(`/bilans/${encodedId}`);
  const confidentiality = metadataString(metadata, "confidentiality");
  const deleted = metadataBoolean(metadata, "deleted");

  if (deleted) {
    throw new Error("Ce bilan INPI est signalé comme supprimé et ne doit pas être conservé.");
  }
  if (confidentiality && normalizedKey(confidentiality) !== "public") {
    throw new Error(`Ce bilan INPI n’est pas public (${confidentiality}).`);
  }

  const { bytes, contentType } = await inpiGetBinary(`/bilans/${encodedId}/download`);
  assertInpiPdf(bytes, contentType);

  const siren = metadataString(metadata, "siren");
  const dateDepot = metadataString(metadata, "dateDepot");
  const dateCloture = metadataString(metadata, "dateCloture");
  const safeSiren = siren && /^\d{9}$/.test(siren) ? siren : "document";
  const safeDate = dateCloture && /^\d{4}-\d{2}-\d{2}$/.test(dateCloture)
    ? dateCloture
    : dateDepot && /^\d{4}-\d{2}-\d{2}$/.test(dateDepot)
      ? dateDepot
      : "date-inconnue";
  const directory = safeInpiOutputDirectory(outputDirectory);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${safeSiren}_${safeDate}_${balanceId}_comptes.pdf`);

  try {
    await writeFile(path, bytes, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const existing = await readFile(path);
    assertInpiPdf(existing, "application/pdf");
    if (!existing.equals(bytes)) {
      throw new Error(
        "Un fichier différent existe déjà pour cet identifiant de bilan INPI ; aucun écrasement n’a été effectué.",
      );
    }
  }

  return {
    balanceId,
    siren: siren ?? null,
    dateDepot: dateDepot ?? null,
    dateCloture: dateCloture ?? null,
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType,
    metadata: sanitizeInpiPublicData(metadata),
    source: inpiSource(),
    limitations: [
      "Seuls les comptes publics sont téléchargés ; les déclarations de confidentialité sont respectées.",
      "Le PDF doit encore être lu avec un outil documentaire et rapproché des données structurées lorsqu’elles existent.",
      "Les comptes sociaux ne déterminent pas automatiquement les revenus ou le patrimoine d’une personne physique.",
    ],
  };
}

export async function getInpiStructuredBalance(value: string): Promise<{
  balanceId: string;
  balance: unknown;
  source: SourceRef;
  limitations: string[];
}> {
  const balanceId = assertInpiDocumentId(value);
  const balance = await inpiGet<unknown>(`/bilans-saisis/${encodeURIComponent(balanceId)}`);
  return {
    balanceId,
    balance: sanitizeInpiPublicData(balance),
    source: inpiSource(),
    limitations: [
      "Le bilan reflète le document déposé et ne constitue pas une cotation Banque de France.",
      "Les comptes confidentiels ou non structurés peuvent être absents de cet endpoint.",
    ],
  };
}
