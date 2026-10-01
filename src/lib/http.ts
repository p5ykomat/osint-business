const DEFAULT_TIMEOUT_MS = 20_000;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json, text/plain;q=0.9, */*;q=0.8");
    }
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", "osint-business-mcp/1.0 (+local business research)");
    }
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      // Never echo authentication responses or query parameters into agent logs.
      const safeUrl = new URL(url);
      safeUrl.search = "";
      safeUrl.username = "";
      safeUrl.password = "";
      await response.body?.cancel();
      throw new HttpError(
        `HTTP ${response.status} pour ${safeUrl.origin}${safeUrl.pathname}`,
        response.status,
        safeUrl.toString(),
      );
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const response = await request(url, {}, timeoutMs);
  return (await response.json()) as T;
}

export async function getText(url: string, timeoutMs?: number): Promise<string> {
  const response = await request(url, {}, timeoutMs);
  return response.text();
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const response = await request(url, init, timeoutMs);
  return (await response.json()) as T;
}
