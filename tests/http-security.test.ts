import { beforeEach, describe, expect, it } from "vitest";
import {
  HttpSecurityError,
  assertSameOrigin,
  consumeRateLimit,
  resetRateLimitsForTests,
  safeInternalPath,
} from "../lib/http/security";
import { csvCell, neutralizeSpreadsheetFormula } from "../lib/exports/csv";

describe("HTTP mutation security", () => {
  beforeEach(resetRateLimitsForTests);

  it("allows only an exact same-origin mutation", () => {
    expect(() => assertSameOrigin(new Request("https://nightprofit.example/api/test", {
      method: "POST",
      headers: { origin: "https://nightprofit.example" },
    }))).not.toThrow();
    for (const origin of ["https://evil.example", "null", "https://nightprofit.example.evil.test"]) {
      expect(() => assertSameOrigin(new Request("https://nightprofit.example/api/test", {
        method: "POST",
        headers: { origin },
      }))).toThrow(HttpSecurityError);
    }
  });

  it("rejects absent origins for cookie-authenticated mutations", () => {
    expect(() => assertSameOrigin(new Request("https://nightprofit.example/api/test", { method: "POST" })))
      .toThrowError("ORIGIN_REQUIRED");
  });

  it("allowlists internal redirects and rejects scheme-relative or backslash paths", () => {
    expect(safeInternalPath("/app/close?date=2026-07-30")).toBe("/app/close?date=2026-07-30");
    expect(safeInternalPath("//evil.example")).toBe("/app/dashboard");
    expect(safeInternalPath("/\\evil.example")).toBe("/app/dashboard");
    expect(safeInternalPath("https://evil.example")).toBe("/app/dashboard");
  });

  it("limits one correlated subject without blocking unrelated subjects", () => {
    consumeRateLimit("tenant-a:user-a", 2, 60_000, 1);
    consumeRateLimit("tenant-a:user-a", 2, 60_000, 2);
    expect(() => consumeRateLimit("tenant-a:user-a", 2, 60_000, 3)).toThrowError("RATE_LIMITED");
    expect(() => consumeRateLimit("tenant-a:user-b", 2, 60_000, 3)).not.toThrow();
  });
});

describe("CSV formula-injection safety", () => {
  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\t=1+1", "\r@SUM(A1)"])(
    "neutralizes %s while preserving its visible value",
    (value) => {
      expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);
      expect(csvCell(value)).toContain(value);
    },
  );

  it("quotes ordinary and quote-containing values safely", () => {
    expect(csvCell("Night \"Profit\"")).toBe("\"Night \"\"Profit\"\"\"");
  });
});
