import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOnCall, mainSlotKey, pickOpenSlot } from "../lib/planning/grid";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const slot = (id: string, start: string, end: string, staff: string | null = null) => ({ id, starts_at: `2026-10-23T${start}:00.000Z`, ends_at: `2026-10-24T${end}:00.000Z`, staff_id: staff });

describe("one-click planning", () => {
  const night = [slot("a", "19:30", "01:15"), slot("b", "19:30", "01:15"), slot("c", "21:00", "01:15"), slot("d", "21:00", "01:15"), slot("e", "21:00", "01:15")];

  it("treats the most common time as the standard time", () => {
    expect(mainSlotKey(night)).toBe("2026-10-23T21:00:00.000Z|2026-10-24T01:15:00.000Z");
  });

  it("fills the standard time first", () => {
    expect(pickOpenSlot(night)?.id).toBe("c");
    expect(pickOpenSlot(night.map((row) => (row.id === "c" ? { ...row, staff_id: "x" } : row)))?.id).toBe("d");
  });

  it("falls back to another open time when the standard time is full", () => {
    const full = night.map((row) => (["c", "d", "e"].includes(row.id) ? { ...row, staff_id: row.id } : row));
    expect(pickOpenSlot(full)?.id).toBe("a");
  });

  it("returns nothing when every plek is taken", () => {
    expect(pickOpenSlot(night.map((row) => ({ ...row, staff_id: row.id })))).toBeUndefined();
  });

  it("marks oproepkrachten by contract type", () => {
    expect(isOnCall({ engagement_type: "temporary" })).toBe(true);
    expect(isOnCall({ engagement_type: "employee" })).toBe(false);
    expect(isOnCall({})).toBe(false);
  });
});

describe("rooster grid wiring", () => {
  const planner = read("../app/planner.tsx");
  const route = read("../app/api/planner/route.ts");

  it("opens on the per-person grid", () => {
    expect(planner).toContain('useState<"nights" | "people">("people")');
  });

  it("plans with one click and only asks when someone said no or is already on", () => {
    expect(planner).toMatch(/shift \|\| value === "unavailable" \? setSheet\(\{ kind: "cell"/);
    expect(planner).toContain("void quickPlan(person, night)");
  });

  it("only lets member managers change the contract type", () => {
    expect(route).toContain('input.action==="set_contract"?"members.manage"');
    expect(route).toContain('engagementType:z.enum(["employee","temporary","contractor"])');
  });
});
