def patch(p, pairs):
    s=open(p).read()
    for old,new in pairs:
        n=s.count(old)
        if n!=1: raise SystemExit(f"{p}: expected 1 got {n}: {old[:70]!r}")
        s=s.replace(old,new)
    open(p,"w").write(s)

patch("lib/http/security.ts",[('''export function assertSameOrigin(request: Request): void {
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
}''','''declare const __BASE44_PREVIEW_APP_ID__: string | undefined;
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
}''')])

patch("vite.config.ts",[('''const localBindingConfig = {''','''// The preview sandbox serves the app on an internal host; the browser posts from the
// public preview domain. Only this app's id is trusted (see lib/http/security.ts).
const base44PreviewAppId =
  process.env.BASE44_PREVIEW_MODE === "1"
    ? (process.env.BASE44_PUBLIC_HOST_SUFFIX ?? "").split("--")[0].replace(/[^a-f0-9]/gi, "")
    : "";

const localBindingConfig = {'''),('''  return {
    server: {''','''  return {
    define: { __BASE44_PREVIEW_APP_ID__: JSON.stringify(base44PreviewAppId) },
    server: {''')])

patch("app/nightprofit-app.tsx",[('''import { OperatingDemo } from "./operating-demo";''','''import Link from "next/link";
import { OperatingDemo } from "./operating-demo";'''),('''<nav><a href="#modules">Product</a><a href="#security">Security</a><a href="#pricing">Prijzen</a></nav><button className="ghost" onClick={onDemo}>Bekijk demo</button></header>''','''<nav><a href="#modules">Product</a><a href="#security">Security</a><a href="#pricing">Prijzen</a></nav><div className="public-auth"><Link className="public-login" href="/login">Inloggen</Link><button className="ghost" onClick={onDemo}>Bekijk demo</button></div></header>'''),
('''<div><button className="primary" onClick={onDemo}>Start winstdiagnose →</button><button className="ghost" onClick={onDemo}>Interactieve demo</button></div></section>''','''<div><Link className="primary" href="/login">Inloggen →</Link><button className="ghost" onClick={onDemo}>Interactieve demo</button></div></section>''')])

p="lib/i18n/authenticated.ts"; s=open(p).read()
a='    "nav.planning": "Rooster",\n'; b='    "nav.planning": "Roster",\n'
assert s.count(a)==1 and s.count(b)==1
s=s.replace(a,a+'    "nav.myRoster": "Mijn rooster",\n').replace(b,b+'    "nav.myRoster": "My roster",\n')
open(p,"w").write(s)
print("login ok")
