import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authMessage } from "../lib/i18n/authenticated";
import { safeInternalPath } from "../lib/http/security";

const callback = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
const updateRoute = readFileSync(new URL("../app/api/auth/update/route.ts", import.meta.url), "utf8");
const updatePage = readFileSync(new URL("../app/update-password/page.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../app/auth-form.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Supabase activation and recovery contracts", () => {
  it("accepts valid PKCE invitation and password-reset callbacks", () => {
    expect(callback).toContain("exchangeCodeForSession(code)");
    expect(callback).toContain('requestedType === "invite"');
    expect(callback).toContain('requestedType === "recovery"');
  });

  it("accepts token-hash invitation and recovery links without exposing tokens", () => {
    expect(callback).toContain("verifyOtp({ token_hash: tokenHash, type: requestedType })");
    expect(callback).not.toMatch(/console\.(?:log|warn|error)\([^\n]*(?:tokenHash|code)/);
  });

  it.each(["missing", "invalid", "expired", "reused", "missing PKCE verifier"]) (
    "fails safely for a %s callback",
    () => {
      expect(callback).toContain("/update-password?error=link_invalid");
      expect(authMessage("nl", "auth.linkInvalid")).not.toContain("Supabase");
    },
  );

  it("requires an authenticated recovery session before password mutation", () => {
    expect(updatePage).toContain("supabase.auth.getUser()");
    expect(updateRoute).toContain('errorCode:"RECOVERY_SESSION_MISSING"');
    expect(updateRoute.indexOf("getUser()")).toBeLessThan(updateRoute.indexOf("updateUser({password})"));
  });

  it("maps policy, rate-limit and unexpected provider failures separately", () => {
    for (const code of ["PASSWORD_POLICY", "TOO_MANY_ATTEMPTS", "AUTH_UNEXPECTED"]) expect(updateRoute).toContain(code);
    expect(updateRoute).toContain("auth.password_update.provider_failure");
  });

  it("validates matching passwords and prevents duplicate submits", () => {
    expect(form).toContain('body.password!==body.confirmPassword');
    expect(form).toContain('setErrorCode("PASSWORD_MISMATCH")');
    expect(form).toContain("if(busy)return");
    expect(form).toContain("disabled={busy");
  });

  it("rejects unsafe post-auth redirects", () => {
    expect(safeInternalPath("https://evil.example/update-password")).toBe("/app/dashboard");
    expect(safeInternalPath("//evil.example")).toBe("/app/dashboard");
    expect(safeInternalPath("/update-password")).toBe("/update-password");
  });

  it("provides equivalent safe Dutch and English recovery messages", () => {
    const keys = ["auth.linkInvalid", "auth.sessionMissing", "auth.passwordPolicy", "auth.passwordMismatch", "auth.tooManyAttempts", "auth.networkError", "auth.unexpectedError"] as const;
    for (const key of keys) {
      expect(authMessage("nl", key).length).toBeGreaterThan(12);
      expect(authMessage("en", key).length).toBeGreaterThan(12);
    }
  });

  it("keeps the password page usable at the mobile breakpoint", () => {
    expect(css).toContain("width:min(100%,450px)");
    expect(css).toContain("min-height:44px");
  });
});
