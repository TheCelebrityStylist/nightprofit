import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { automaticReminderDue, remindable, reminderMessage, MAX_REMINDERS } from "../lib/workforce/reminders";
import { buildCalendar, escapeText, fold } from "../lib/planning/ics";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const HOUR = 3600_000;
const now = Date.parse("2026-10-20T12:00:00Z");
const at = (hours: number) => new Date(now + hours * HOUR).toISOString();

describe("automatic reminders", () => {
  it("fires once the deadline is within a day, not in the last hour", () => {
    expect(automaticReminderDue({ status: "scheduled", deadline_at: at(23), created_at: at(-20) }, now)).toBe(true);
    expect(automaticReminderDue({ status: "scheduled", deadline_at: at(30), created_at: at(-20) }, now)).toBe(false);
    expect(automaticReminderDue({ status: "scheduled", deadline_at: at(0.5), created_at: at(-20) }, now)).toBe(false);
  });

  it("waits six hours after the request went out and skips closed requests", () => {
    expect(automaticReminderDue({ status: "scheduled", deadline_at: at(12), created_at: at(-2) }, now)).toBe(false);
    expect(automaticReminderDue({ status: "cancelled", deadline_at: at(12), created_at: at(-20) }, now)).toBe(false);
  });

  it("only nudges people who have not answered, once automatically", () => {
    const base = { id: "r", staff_id: "s", reminder_count: 0, reminded_at: null };
    expect(remindable({ ...base, status: "sent" }, "auto", now)).toBe(true);
    expect(remindable({ ...base, status: "opened" }, "auto", now)).toBe(true);
    expect(remindable({ ...base, status: "submitted" }, "auto", now)).toBe(false);
    expect(remindable({ ...base, status: "partial" }, "auto", now)).toBe(false);
    expect(remindable({ ...base, status: "sent", reminder_count: 1, reminded_at: at(-5) }, "auto", now)).toBe(false);
  });

  it("lets the planner remind again after three hours, at most twice", () => {
    const base = { id: "r", staff_id: "s", status: "sent" };
    expect(remindable({ ...base, reminder_count: 1, reminded_at: at(-1) }, "manual", now)).toBe(false);
    expect(remindable({ ...base, reminder_count: 1, reminded_at: at(-4) }, "manual", now)).toBe(true);
    expect(remindable({ ...base, reminder_count: MAX_REMINDERS, reminded_at: at(-10) }, "manual", now)).toBe(false);
  });

  it("writes a short personal nudge", () => {
    expect(reminderMessage("nl", "Sam", "vr 23 en za 24 okt", "wo 21 okt 20:00", "https://x/a")).toBe("Hoi Sam, nog even: kun je vr 23 en za 24 okt? Laat het weten vóór wo 21 okt 20:00: https://x/a");
  });
});

describe("calendar feed", () => {
  const ics = buildCalendar("Rooster Cliniq", [
    { uid: "a@cliniq.team", start: "2026-10-23T21:00:00.000Z", end: "2026-10-24T01:15:00.000Z", summary: "Cliniq · Barmedewerker", location: "Cliniq, Platielstraat 9A, Maastricht", sequence: 2 },
    { uid: "b@cliniq.team", start: "2026-10-24T21:00:00.000Z", end: "2026-10-25T02:15:00.000Z", summary: "Cliniq", cancelled: true },
  ], "2026-10-20T10:00:00.000Z");

  it("is a valid calendar with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });

  it("uses UTC times, escapes text and marks cancelled shifts", () => {
    expect(ics).toContain("DTSTART:20261023T210000Z");
    expect(ics).toContain("DTEND:20261024T011500Z");
    expect(ics).toContain("LOCATION:Cliniq\\, Platielstraat 9A\\, Maastricht");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("escapes and folds per RFC 5545", () => {
    expect(escapeText("a;b,c\\d\ne")).toBe("a\;b\\,c\\\\d\\ne");
    const long = `DESCRIPTION:${"é".repeat(60)}`;
    expect(fold(long).split("\r\n ").join("")).toBe(long);
  });
});

describe("wiring", () => {
  const cron = read("../app/api/cron/reminders/route.ts");
  const manual = read("../app/api/availability/reminders/route.ts");
  const feed = read("../app/api/calendar/[token]/route.ts");
  const schedule = read("../supabase/migrations/20260729003700_hourly_reminder_schedule.sql");
  const tables = read("../supabase/migrations/20260729003600_reminders_and_calendar_feeds.sql");

  it("only runs the hourly job with the Vault secret", () => {
    expect(cron).toContain('rpc("cron_token_valid"');
    expect(schedule).toContain("grant execute on function public.cron_token_valid(text) to service_role");
    expect(schedule).toContain("revoke execute on function public.cron_token_valid(text) from public, anon, authenticated");
  });

  it("lets only workforce managers remind by hand", () => {
    expect(manual).toContain('requireMembership(input.organisationId,"workforce.manage",input.venueId)');
  });

  it("keeps calendar tokens hashed and server-only", () => {
    expect(tables).toContain("revoke all on public.staff_calendar_feeds from anon, authenticated");
    expect(feed).toContain("hashAvailabilityToken(token)");
  });
});
