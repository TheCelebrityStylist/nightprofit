const windows = new Map<string, { count: number; resetAt: number }>();

export class HttpSecurityError extends Error {
  constructor(
    readonly code: "ORIGIN_REQUIRED" | "CROSS_ORIGIN_REQUEST" | "RATE_LIMITED",
    readonly status: 403 | 429,
  ) {
    super(code);
  }
}

export function assertSameOrigin(request: Request): void {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpSecurityError("ORIGIN_REQUIRED", 403);
  let supplied: URL;
  try {
    supplied = new URL(origin);
  } catch {
    throw new HttpSecurityError("CROSS_ORIGIN_REQUEST", 403);
  }
  if (supplied.origin !== requestUrl.origin) throw new HttpSecurityError("CROSS_ORIGIN_REQUEST", 403);
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
