import { readFileSync } from "node:fs";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { openText, sealText } from "../lib/push/push";
import { buildCalendar } from "../lib/planning/ics";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("push keys", () => {
  it("seals the signing key so only the server can read it", async () => {
    const sealed = await sealText("private-key", "service-secret");
    expect(JSON.stringify(sealed)).not.toContain("private-key");
    expect(await openText(sealed, "service-secret")).toBe("private-key");
    expect(await openText(sealed, "other-secret")).toBeNull();
  });

  it("produces an encrypted, signed request a browser push service accepts", () => {
    const keys = webpush.generateVAPIDKeys();
    const browser = createECDH("prime256v1"); browser.generateKeys();
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/example", keys: { p256dh: browser.getPublicKey("base64url"), auth: randomBytes(16).toString("base64url") } };
    const details = webpush.generateRequestDetails(subscription, JSON.stringify({ title: "Kun je werken?", body: "vr 23 okt" }), { vapidDetails: { subject: "https://nightprofit-two.vercel.app", publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 60 });
    expect(details.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(String(details.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    expect((details.body as Buffer).length).toBeGreaterThan(100);
  });
});

describe("calendar alarm", () => {
  it("adds a two-hour alert to shifts, not to cancelled ones", () => {
    const ics = buildCalendar("Rooster", [
      { uid: "a", start: "2026-10-23T21:00:00.000Z", end: "2026-10-24T02:15:00.000Z", summary: "Cliniq", alarmMinutes: 120 },
      { uid: "b", start: "2026-10-24T21:00:00.000Z", end: "2026-10-25T02:15:00.000Z", summary: "Cliniq", alarmMinutes: 120, cancelled: true },
    ]);
    expect(ics.match(/BEGIN:VALARM/g)?.length).toBe(1);
    expect(ics).toContain("TRIGGER:-PT120M");
  });
});

describe("wiring", () => {
  const migration = read("../supabase/migrations/20260729003800_push_notifications.sql");
  const worker = read("../public/sw.js");
  const manifest = JSON.parse(read("../public/manifest.webmanifest")) as { display: string; icons: unknown[] };

  it("keeps subscriptions and secrets server-only", () => {
    expect(migration).toContain("revoke all on public.push_subscriptions from anon, authenticated");
    expect(migration).toContain("revoke all on public.app_secrets from anon, authenticated");
  });

  it("is installable and shows notifications", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect(worker).toContain("showNotification");
    expect(worker).toContain("notificationclick");
  });

  it("notifies on request, publish, reminder and before a shift", () => {
    expect(read("../app/api/availability/route.ts")).toContain("pushToStaff(");
    expect(read("../app/api/planner/route.ts")).toContain("announceRoster(");
    expect(read("../lib/workforce/reminders.ts")).toContain("pushToStaff(");
    expect(read("../app/api/cron/reminders/route.ts")).toContain("remindUpcomingShifts(");
  });
});
