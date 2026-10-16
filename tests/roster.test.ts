import { describe, expect, it } from "vitest";
import { formatMinor, isoWeekNumber, localToInstant, paidMinutes, rankCandidates, shiftCostMinor, shiftWarnings, shiftWindow, weekStartOf, whatsappNumber } from "../lib/roster";

describe("roster rules", () => {
  it("finds the ISO week start and number", () => {
    expect(weekStartOf("2026-10-16")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
    expect(isoWeekNumber("2026-10-16")).toBe(42);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
  });

  it("converts venue-local times across DST and midnight", () => {
    expect(localToInstant("2026-10-16", "22:00", "Europe/Amsterdam")).toBe("2026-10-16T20:00:00.000Z");
    expect(localToInstant("2026-12-04", "22:00", "Europe/Amsterdam")).toBe("2026-12-04T21:00:00.000Z");
    // Night of the DST change (25 Oct 2026): 22:00 CEST -> 05:00 CET is 8 hours.
    const night = shiftWindow("2026-10-24", "22:00", "05:00", "Europe/Amsterdam");
    expect(night).toEqual({ startsAt: "2026-10-24T20:00:00.000Z", endsAt: "2026-10-25T04:00:00.000Z" });
    expect(paidMinutes(night.startsAt, night.endsAt, 30)).toBe(450);
  });

  it("costs shifts in integer cents, rounding half up", () => {
    expect(shiftCostMinor(450, 1850)).toBe(13875n);
    expect(shiftCostMinor(1, 1850)).toBe(31n); // 30.83 -> 31
    expect(shiftCostMinor(1, 30)).toBe(1n); // 0.5 -> 1
    expect(shiftCostMinor(0, 99999)).toBe(0n);
    expect(formatMinor(13875n)).toBe("€ 138,75");
    expect(formatMinor(123456789n)).toBe("€ 1.234.567,89");
  });

  it("flags unavailability, leave and double bookings", () => {
    const base = { status: "scheduled" as const, break_minutes: 0, hourly_cost_minor: 1500 };
    const a = { ...base, id: "a", employee_id: "e1", service_date: "2026-10-16", starts_at: "2026-10-16T20:00:00Z", ends_at: "2026-10-17T02:00:00Z" };
    const b = { ...base, id: "b", employee_id: "e1", service_date: "2026-10-16", starts_at: "2026-10-17T01:00:00Z", ends_at: "2026-10-17T03:00:00Z" };
    const warnings = shiftWarnings(a, {
      shifts: [a, b],
      availability: [{ employee_id: "e1", service_date: "2026-10-16", status: "unavailable" }],
      leave: [{ employee_id: "e1", kind: "leave", starts_on: "2026-10-15", ends_on: "2026-10-16", status: "approved" }],
    });
    expect(warnings).toEqual(["unavailable", "on_leave", "overlap"]);
  });

  it("ranks staffing alternatives deterministically", () => {
    const open = { id: "open", service_date: "2026-10-16", starts_at: "2026-10-16T20:00:00Z", ends_at: "2026-10-17T02:00:00Z" };
    const employees = [
      { id: "sick", active: true, contract_minutes_week: 1200 },
      { id: "available", active: true, contract_minutes_week: 1200 },
      { id: "preferred", active: true, contract_minutes_week: null },
      { id: "unknown", active: true, contract_minutes_week: 1200 },
      { id: "busy", active: true, contract_minutes_week: 1200 },
      { id: "inactive", active: false, contract_minutes_week: 1200 },
    ];
    const ranked = rankCandidates(open, employees, {
      shifts: [{ id: "x", employee_id: "busy", service_date: "2026-10-16", starts_at: "2026-10-16T22:00:00Z", ends_at: "2026-10-17T01:00:00Z", break_minutes: 0, hourly_cost_minor: 0, status: "scheduled" }],
      availability: [
        { employee_id: "available", service_date: "2026-10-16", status: "available" },
        { employee_id: "preferred", service_date: "2026-10-16", status: "preferred" },
      ],
      leave: [{ employee_id: "sick", kind: "sick", starts_on: "2026-10-16", ends_on: "2026-10-16", status: "approved" }],
    });
    expect(ranked.map((candidate) => candidate.employeeId)).toEqual(["preferred", "available", "unknown"]);
  });

  it("normalises Dutch numbers for WhatsApp", () => {
    expect(whatsappNumber("06 12345678")).toBe("31612345678");
    expect(whatsappNumber("+31 6 1234 5678")).toBe("31612345678");
    expect(whatsappNumber("0032 470 12 34 56")).toBe("32470123456");
    expect(whatsappNumber("12")).toBeNull();
  });
});
