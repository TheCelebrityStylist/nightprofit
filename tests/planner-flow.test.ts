import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, deadlineLabel, isoWeekNumber, mondayOf, nightOf, nightsLabel, zonedInstant } from "../lib/planning/nights";
import { onboardingMessage } from "../lib/workforce/onboarding";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("night helpers", () => {
  it("names nights the way you'd say them", () => {
    expect(nightsLabel(["2026-10-24", "2026-10-22", "2026-10-23"])).toBe("do 22, vr 23 en za 24 okt");
    expect(nightsLabel(["2026-10-30", "2026-11-05"])).toBe("vr 30 okt en do 5 nov");
    expect(nightsLabel(["2026-10-22"], "en")).toBe("Thu 22 Oct");
  });
  it("counts an early-morning shift end for the night before", () => {
    expect(nightOf("2026-10-23T00:30:00Z")).toBe("2026-10-22");
    expect(nightOf("2026-10-22T19:30:00Z")).toBe("2026-10-22");
  });
  it("converts local times across daylight saving", () => {
    expect(zonedInstant("2026-10-24", "18:00")).toBe("2026-10-24T16:00:00.000Z");
    expect(zonedInstant("2026-10-26", "18:00")).toBe("2026-10-26T17:00:00.000Z");
    expect(zonedInstant("2026-03-29", "05:00")).toBe("2026-03-29T03:00:00.000Z");
  });
  it("finds the week", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(addDays("2026-10-19", 7)).toBe("2026-10-26");
    expect(isoWeekNumber("2026-10-19")).toBe(43);
    expect(deadlineLabel("2026-10-21T18:00:00Z")).toContain("20:00");
  });
});

describe("personal and invitation-only", () => {
  it("greets people by first name", () => {
    expect(onboardingMessage("nl", "Sam", "Cliniq", "https://x.test/i")).toMatch(/^Hoi Sam! /);
    expect(read("../app/my-roster.tsx")).toContain('tx("Hoi", "Hi")} {firstName}');
    expect(read("../app/planner.tsx")).toContain("Hoi {plannerName");
  });
  it("closes self sign-up", () => {
    expect(read("../app/api/auth/signup/route.ts")).toContain("INVITE_ONLY");
    expect(read("../app/api/onboarding/route.ts")).toContain("INVITE_ONLY");
    expect(read("../supabase/migrations/20260729003500_invitation_only_organisations.sql")).toContain("revoke execute on function public.create_organisation(text,text) from public,anon,authenticated;");
  });
  it("only accepts answers for nights the planner asked about", () => {
    const sql = read("../supabase/migrations/20260729003400_night_requests_and_slot_planning.sql");
    expect(sql).toContain("night_not_requested");
    expect(read("../app/api/availability/respond/route.ts")).toContain("submit_availability_request_v3");
    expect(read("../app/api/workforce/my-availability/route.ts")).toContain("requestId");
  });
});
