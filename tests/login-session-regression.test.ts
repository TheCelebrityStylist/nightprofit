import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("login session isolation regression", () => {
  const route = readFileSync(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../lib/supabase/server.ts", import.meta.url), "utf8");

  it("verifies credentials without reading or refreshing stale browser cookies", () => {
    expect(route).toContain("createSupabaseCredentialClient()");
    expect(route.indexOf("signInWithPassword")).toBeLessThan(route.indexOf("createSupabaseServerClient()"));
    expect(server).toContain("persistSession: false");
    expect(server).toContain("autoRefreshToken: false");
  });

  it("writes only an accepted session to the cookie-aware SSR client", () => {
    expect(route).toContain("supabase.auth.setSession");
    expect(route).toContain(
      'console.error("auth.login.provider_failure",{correlationId,status:error?.status??null})',
    );
    expect(route).toContain(
      'console.error("auth.login.session_failure",{correlationId,status:sessionError.status??null})',
    );
  });
});
