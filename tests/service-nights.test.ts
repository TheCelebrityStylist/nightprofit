import { describe, expect, it } from "vitest";
import { describeLines, isoWeekday, lineMinutes, parseEuroRate, patternHeadcount, serviceLinesSchema } from "../lib/workforce/service-nights";

const bar = "11111111-1111-4111-8111-111111111111";
const dj = "22222222-2222-4222-8222-222222222222";
const lane = (roleId: string) => (roleId === dj ? "dj" : "staff") as "staff" | "dj";

describe("service nights", () => {
  it("validates Cliniq's Friday: 2 early, 7 late, 1 DJ", () => {
    const lines = serviceLinesSchema.parse([
      { role_id: bar, count: 2, start: "21:30", end: "03:00" },
      { role_id: bar, count: 7, start: "23:00", end: "03:00" },
      { role_id: dj, count: 1, start: "23:00", end: "03:00" },
    ]);
    expect(lines[0].break_minutes).toBe(0);
    expect(patternHeadcount({ venue_id: "v", iso_weekday: 5, active: true, lines }, lane, "staff")).toBe(9);
    expect(patternHeadcount({ venue_id: "v", iso_weekday: 5, active: true, lines }, lane, "dj")).toBe(1);
    expect(patternHeadcount({ venue_id: "v", iso_weekday: 5, active: false, lines }, lane, "staff")).toBe(0);
  });

  it("rejects impossible lines", () => {
    expect(() => serviceLinesSchema.parse([{ role_id: bar, count: 0, start: "21:30", end: "02:00" }])).toThrow();
    expect(() => serviceLinesSchema.parse([{ role_id: bar, count: 1, start: "23:00", end: "23:00" }])).toThrow();
    expect(() => serviceLinesSchema.parse([{ role_id: bar, count: 1, start: "24:00", end: "02:00" }])).toThrow();
  });

  it("counts hours across midnight", () => {
    expect(lineMinutes({ start: "21:30", end: "02:00", break_minutes: 0 })).toBe(270);
    expect(lineMinutes({ start: "23:00", end: "03:00", break_minutes: 0 })).toBe(240);
    expect(lineMinutes({ start: "18:00", end: "23:30", break_minutes: 30 })).toBe(300);
  });

  it("parses Dutch and English hourly rates", () => {
    expect(parseEuroRate("15,50")).toBe(1550n);
    expect(parseEuroRate("15.5")).toBe(1550n);
    expect(parseEuroRate("€ 18")).toBe(1800n);
    expect(parseEuroRate("1.850,00")).toBeNull();
    expect(parseEuroRate("-3")).toBeNull();
  });

  it("maps weekdays to ISO numbers and describes lines", () => {
    expect(isoWeekday(new Date(2026, 9, 15))).toBe(4);
    expect(isoWeekday(new Date(2026, 9, 18))).toBe(7);
    expect(describeLines([{ role_id: bar, count: 2, start: "21:30", end: "02:00", break_minutes: 0 }], () => "Bar")).toBe("2× 21:30–02:00");
  });
});
