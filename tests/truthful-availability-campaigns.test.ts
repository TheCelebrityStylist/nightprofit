import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../supabase/migrations/20260729002700_truthful_availability_campaigns.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(new URL("../app/api/availability/route.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../app/availability-manager.tsx", import.meta.url), "utf8");

describe("truthful availability campaigns", () => {
  it("never claims an unsent recipient was sent or delivered", () => {
    expect(sql).toContain("when 'valid' then 'ready'");
    expect(sql).toContain("when 'invalid' then 'invalid_phone'");
    expect(sql).toContain("'delivery_available',false");
    expect(sql).toContain("'missing_phone','invalid_phone'");
    expect(sql).not.toContain("recipient_status='sent'");
  });

  it("persists phone readiness and reminder policy with the campaign", () => {
    expect(route).toContain("phone_state:phoneState");
    expect(route).toContain("destination_e164:phone");
    expect(sql).toContain('"schedule_hours_before_deadline":[48,12]');
  });

  it("replays repeated campaign creation without creating duplicate recipients", () => {
    expect(sql).toContain("availability_request_idempotency_unique");
    expect(sql).toContain("'replayed',true");
    expect(route).toContain("target_idempotency_key:input.idempotencyKey");
    expect(manager).toContain("idempotencyKey: commandKey");
  });

  it("archives every replaced employee response before deletion", () => {
    expect(sql).toContain("availability_response_revisions");
    expect(sql).toContain("before delete on public.staff_availability");
    expect(sql).toContain("unique(organisation_id,source_row_id)");
  });

  it("shows provider readiness and missing-phone counts before creation", () => {
    expect(manager).toContain("availability-campaign-summary");
    expect(manager).toContain("WhatsApp provider not connected");
    expect(manager).toContain("schedule");
    expect(manager).toContain("Message preview");
  });
});
