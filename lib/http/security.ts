const windows = new Map<string, { count: number; resetAt: number }>();

export class HttpSecurityError extends Error {
  constructor(
    readonly code: "ORIGIN_REQUIRED" | "CROSS_ORIGIN_REQUEST" | "RATE_LIMITED",
    readonly status: 403 | 429,
  ) {
    super(code);
  }
}

declare const __BASE44_PREVIEW_APP_ID__: string | undefined;
const previewAppId = typeof __BASE44_PREVIEW_APP_ID__ === "string" ? __BASE44_PREVIEW_APP_ID__ : "";

/**
 * Origins a browser may legitimately post from. Behind a proxy the server sees an
 * internal host, so the forwarded host counts too; in a Base44 preview sandbox the
 * public preview domain of this app (and only this app) is accepted.
 */
export function trustedOrigin(origin: URL, request: Request, appId = previewAppId): boolean {
  const requestUrl = new URL(request.url);
  if (origin.origin === requestUrl.origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || origin.protocol.replace(":", "");
    if (origin.origin === `${proto}://${forwardedHost}`) return true;
  }
  if (appId && origin.protocol === "https:" && (origin.hostname.endsWith(".base44-preview.app") || origin.hostname.endsWith(".base44.app")) && origin.hostname.includes(appId)) return true;
  return false;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpSecurityError("ORIGIN_REQUIRED", 403);
  let supplied: URL;
  try {
    supplied = new URL(origin);
  } catch {
    throw new HttpSecurityError("CROSS_ORIGIN_REQUEST", 403);
  }
  if (!trustedOrigin(supplied, request)) throw new HttpSecurityError("CROSS_ORIGIN_REQUEST", 403);
}

export function safeInternalPath(value: string | null | undefined, fallback = "/app/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const parsed = new URL(value, "https://nightprofit.invalid");
    return parsed.origin === "https://nightprofit.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): void {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) throw new HttpSecurityError("RATE_LIMITED", 429);
  current.count += 1;
}

export async function opaqueRateLimitKey(request: Request, scope: string, subject: string): Promise<string> {
  const network = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "unknown";
  const bytes = new TextEncoder().encode(`${scope}\0${network}\0${subject.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function securityErrorResponse(error: unknown): Response | null {
  if (!(error instanceof HttpSecurityError)) return null;
  return Response.json({ errorCode: error.code }, {
    status: error.status,
    headers: error.status === 429 ? { "retry-after": "60" } : undefined,
  });
}

export function resetRateLimitsForTests(): void {
  windows.clear();
}
