import { describe, expect, it } from "vitest";
import {
  connectedState,
  connectorStates,
  exponentialBackoffSeconds,
  normalizeLegacyConnectorState,
  providerErrorSchema,
} from "../lib/integrations/contracts";

describe("connector safety contracts", () => {
  it("only reports connected after an authenticated provider request", () => {
    expect(connectedState({ authenticatedRequestSucceeded: false, providerAccountId: null, checkedAt: new Date().toISOString(), scopes: [] })).toBe("failed");
    expect(connectedState({ authenticatedRequestSucceeded: true, providerAccountId: "acct_1", checkedAt: new Date().toISOString(), scopes: ["read"] })).toBe("connected");
  });

  it("uses bounded exponential retry delays", () => {
    expect([1, 2, 3, 10].map((attempt) => exponentialBackoffSeconds(attempt))).toEqual([30, 60, 120, 3600]);
  });

  it("requires provider errors to be normalized without raw secrets", () => {
    expect(providerErrorSchema.parse({ code: "rate_limited", category: "rate_limit", retryable: true, retryAfterSeconds: 30, safeMessage: "Provider rate limit reached." }).retryable).toBe(true);
  });

  it("accepts every reviewed legacy and current connection status", () => {
    expect(connectorStates).toEqual([
      "disconnected", "connecting", "connected", "degraded", "error",
      "not_configured", "authorization_required", "syncing", "failed", "disabled",
    ]);
  });

  it("maps legacy states deterministically without changing stored evidence", () => {
    expect(normalizeLegacyConnectorState("disconnected")).toBe("not_configured");
    expect(normalizeLegacyConnectorState("connecting")).toBe("syncing");
    expect(normalizeLegacyConnectorState("error")).toBe("failed");
    expect(normalizeLegacyConnectorState("connected")).toBe("connected");
  });
});
