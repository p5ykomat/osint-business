export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function assertSiren(value: string): string {
  const siren = digitsOnly(value);
  if (!/^\d{9}$/.test(siren)) {
    throw new Error("Le SIREN doit contenir exactement 9 chiffres.");
  }
  return siren;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function givenNamesMatch(expected: string, candidate: string): boolean {
  const expectedTokens = normalizeText(expected).split(" ").filter(Boolean);
  const candidateTokens = normalizeText(candidate).split(" ").filter(Boolean);
  if (expectedTokens.length === 0 || candidateTokens.length === 0) return false;

  // Require the first given name to match to avoid linking namesakes.
  if (expectedTokens[0] !== candidateTokens[0]) return false;

  const candidateSet = new Set(candidateTokens);
  return expectedTokens.every((token) => candidateSet.has(token));
}

export function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}
