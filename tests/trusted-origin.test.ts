import { describe, expect, it } from "vitest";
import { trustedOrigin } from "../lib/http/security";

const appId = "6ad24d7d339c67bea858f42c";
const post = (url: string, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers });

describe("trustedOrigin", () => {
  it("accepts the same origin", () => {
    expect(trustedOrigin(new URL("https://app.example.com"), post("https://app.example.com/api/auth/login"), "")).toBe(true);
  });
  it("accepts the forwarded host behind a proxy", () => {
    expect(trustedOrigin(new URL("https://app.example.com"), post("http://10.0.0.4:3000/api/auth/login", { "x-forwarded-host": "app.example.com", "x-forwarded-proto": "https" }), "")).toBe(true);
  });
  it("accepts this app's Base44 preview domain while the server sees the sandbox host", () => {
    expect(trustedOrigin(new URL(`https://${appId}--b-aa92612-d058.imported.base44-preview.app`), post("http://3000-abc.e2b.app/api/auth/login"), appId)).toBe(true);
  });
  it("rejects other apps and other sites", () => {
    expect(trustedOrigin(new URL("https://otherapp--b-1.imported.base44-preview.app"), post("http://3000-abc.e2b.app/api/auth/login"), appId)).toBe(false);
    expect(trustedOrigin(new URL(`https://${appId}.evil.example`), post("http://3000-abc.e2b.app/api/auth/login"), appId)).toBe(false);
    expect(trustedOrigin(new URL(`http://${appId}.base44.app`), post("http://3000-abc.e2b.app/api/auth/login"), appId)).toBe(false);
    expect(trustedOrigin(new URL(`https://${appId}--x.base44-preview.app`), post("http://3000-abc.e2b.app/api/auth/login"), "")).toBe(false);
  });
});
