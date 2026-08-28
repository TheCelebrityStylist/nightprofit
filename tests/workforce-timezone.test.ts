import { describe, expect, it } from "vitest";
import { utcToZonedInput, zonedInputToUtc } from "../lib/workforce/timezone";

describe("workforce venue timezone conversion", () => {
  it("preserves the exact entered overnight Amsterdam service", () => {
    expect(zonedInputToUtc("2026-09-04T22:00", "Europe/Amsterdam")).toBe("2026-09-04T20:00:00.000Z");
    expect(utcToZonedInput("2026-09-05T03:00:00.000Z", "Europe/Amsterdam")).toBe("2026-09-05T05:00");
  });

  it("uses the post-transition offset after the autumn DST change", () => {
    expect(zonedInputToUtc("2026-10-26T18:00", "Europe/Amsterdam")).toBe("2026-10-26T17:00:00.000Z");
  });

  it("rejects a non-existent spring DST wall time", () => {
    expect(() => zonedInputToUtc("2026-03-29T02:30", "Europe/Amsterdam")).toThrow("NON_EXISTENT_LOCAL_DATE_TIME");
  });
});
