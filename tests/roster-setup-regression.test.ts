import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("guided roster setup", () => {
  it("remounts each setup step so values cannot leak into the next form", () => {
    const source = readFileSync("app/roster-board.tsx", "utf8");

    expect(source).toContain('key="department-setup"');
    expect(source).toContain('key="role-setup"');
    expect(source).toContain('key="staff-setup"');
  });

  it("normalizes manual phone numbers and rejects duplicate staff", () => {
    const source = readFileSync("app/api/planning/route.ts", "utf8");

    expect(source).toContain("normalizeDutchPhone(values.phone)");
    expect(source).toContain('errorCode:"DUPLICATE_STAFF"');
    expect(source).toContain("duplicateError");
  });

  it("allows approved CSV rows while retaining rejected-row evidence", () => {
    const route = readFileSync("app/api/workforce/employees/route.ts", "utf8");
    const component = readFileSync("app/employee-csv-import.tsx", "utf8");

    expect(route).not.toContain("REJECTED_ROWS_REMAIN");
    expect(route).toContain("rejected:preview.rejected");
    expect(component).toContain("preview.accepted.length === 0");
  });

  it("persists one concurrency-controlled break window inside its shift", () => {
    const route = readFileSync("app/api/planning/route.ts", "utf8");
    expect(route).toContain('input.action==="break_plan"');
    expect(route).toContain('throw new Error("BREAK_OUTSIDE_SHIFT")');
    expect(route).toContain('.eq("revision",existingPlan.revision).select("id").single()');
    expect(route).toContain('status:"adjusted",revision:existingPlan.revision+1');
  });
});
