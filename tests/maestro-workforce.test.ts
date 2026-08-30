import { describe, expect, it } from "vitest";
import {
  availabilityConflicts,
  laborPercentageBasisPoints,
  rankSchedulingCandidates,
  selectReminderRecipients,
  serviceTradingDate,
  shiftMinutes,
  supplementedLaborCostMinor,
} from "../lib/workforce/maestro";

describe("Maestroplanner deterministic workforce rules", () => {
  it("keeps an overnight service on the originating trading date", () => {
    expect(serviceTradingDate("2026-09-05T02:00:00+02:00", "Europe/Amsterdam")).toBe(
      "2026-09-04",
    );
    expect(serviceTradingDate("2026-10-25T02:30:00+02:00", "Europe/Amsterdam")).toBe(
      "2026-10-24",
    );
  });

  it("calculates exact shift minutes, supplements and labor percentages", () => {
    expect(
      shiftMinutes("2026-09-04T22:00:00+02:00", "2026-09-05T05:00:00+02:00", 30),
    ).toBe(390);
    expect(supplementedLaborCostMinor(390, 2_000n, 2_500)).toEqual({
      baseMinor: 13_000n,
      supplementMinor: 3_250n,
      totalMinor: 16_250n,
    });
    expect(laborPercentageBasisPoints(16_250n, 100_000n)).toBe(1_625);
    expect(laborPercentageBasisPoints(0n, 0n)).toBeNull();
  });

  it("selects reminders only for active incomplete recipients", () => {
    const rows = [
      { id: "a", status: "opened", active: true, optedOut: false },
      { id: "b", status: "partial", active: true, optedOut: false },
      { id: "c", status: "submitted", active: true, optedOut: false },
      { id: "d", status: "opened", active: false, optedOut: false },
      { id: "e", status: "opened", active: true, optedOut: true },
    ];
    expect(selectReminderRecipients(rows).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("never schedules unknown or unavailable employees", () => {
    const candidates = [
      { staffId: "unknown", hourlyCostMinor: 1_000n, contractedMinutes: 600, alreadyPlannedMinutes: 0, availability: "unknown" as const, eligible: true },
      { staffId: "unavailable", hourlyCostMinor: 1_000n, contractedMinutes: 600, alreadyPlannedMinutes: 0, availability: "unavailable" as const, eligible: true },
      { staffId: "preferred", hourlyCostMinor: 2_000n, contractedMinutes: 600, alreadyPlannedMinutes: 300, availability: "preferred" as const, eligible: true },
      { staffId: "available", hourlyCostMinor: 1_500n, contractedMinutes: 600, alreadyPlannedMinutes: 0, availability: "available" as const, eligible: true },
    ];
    expect(rankSchedulingCandidates(candidates, "preference").map((row) => row.staffId)).toEqual([
      "preferred",
      "available",
    ]);
    expect(rankSchedulingCandidates(candidates, "lowest_cost")[0].staffId).toBe("available");
  });

  it("treats missing availability as unknown and renders explicit conflicts", () => {
    expect(availabilityConflicts("2026-09-04T20:00:00Z", "2026-09-05T01:00:00Z", [])).toEqual([
      "unknown",
    ]);
    expect(
      availabilityConflicts("2026-09-04T20:00:00Z", "2026-09-05T01:00:00Z", [
        { startsAt: "2026-09-04T22:00:00Z", endsAt: "2026-09-05T00:00:00Z", state: "unavailable" },
      ]),
    ).toEqual(["unavailable"]);
  });
});
