/**
 * Availability reminders: one WhatsApp nudge to people who have not answered, about 24 hours before the deadline.
 * Used by the hourly schedule (automatic) and by the planner's "remind now" button.
 * Every reminder gets a fresh personal link; the earlier link keeps working until the deadline.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAvailabilityToken, hashAvailabilityToken } from "./availability";
import { normalizeDutchPhone } from "./domain";
import { sendTemplate } from "../whatsapp/cloud";
import { loadWhatsapp } from "../whatsapp/store";
import { deadlineLabel, firstName, nightsLabel } from "../planning/nights";

const HOUR = 3600_000;
/** Statuses where someone has not answered anything yet. */
export const NOT_ANSWERED = ["draft", "ready", "sent", "manually_shared", "provider_accepted", "delivered", "read", "opened", "reminder_due", "failed"];
export const MAX_REMINDERS = 2;

type Period = { id: string; organisation_id: string; venue_id: string; deadline_at: string; created_at: string; status: string; requested_dates: string[] | null; starts_at: string; ends_at: string };
type Recipient = { id: string; staff_id: string; status: string; reminder_count: number; reminded_at: string | null };
type Person = { id: string; full_name: string; preferred_language: string; contact_phone: string | null; employment_status: string };

/** Automatic window: deadline between 1 and 24 hours away, and the request has been out for at least 6 hours. */
export function automaticReminderDue(period: Pick<Period, "status" | "deadline_at" | "created_at">, now: number) {
  if (["closed", "cancelled"].includes(period.status)) return false;
  const left = new Date(period.deadline_at).getTime() - now;
  return left > HOUR && left <= 24 * HOUR && now - new Date(period.created_at).getTime() >= 6 * HOUR;
}

/** Who gets a reminder. Automatic: once per request. Manual: at most twice, and not twice within three hours. */
export function remindable(recipient: Recipient, mode: "auto" | "manual", now: number) {
  if (!NOT_ANSWERED.includes(recipient.status) || recipient.reminder_count >= MAX_REMINDERS) return false;
  if (mode === "auto") return !recipient.reminded_at;
  return !recipient.reminded_at || now - new Date(recipient.reminded_at).getTime() >= 3 * HOUR;
}

export function reminderMessage(language: string, name: string, nights: string, deadline: string, url: string) {
  return language === "en"
    ? `Hi ${name}, quick reminder: can you work ${nights}? Let us know before ${deadline}: ${url}`
    : `Hoi ${name}, nog even: kun je ${nights}? Laat het weten vóór ${deadline}: ${url}`;
}

export type ReminderOutcome = { staffId: string; name: string; state: "sent" | "failed" | "manual" | "skipped"; detail: string; whatsappUrl?: string };

export async function sendReminders(
  db: SupabaseClient,
  options: { origin: string; mode: "auto" | "manual"; now?: number; organisationId?: string; venueId?: string; requestId?: string; actorId?: string },
) {
  const now = options.now ?? Date.now();
  let query = db.from("availability_request_periods").select("id,organisation_id,venue_id,deadline_at,created_at,status,requested_dates,starts_at,ends_at").not("status", "in", "(closed,cancelled)");
  if (options.requestId) query = query.eq("id", options.requestId);
  if (options.organisationId) query = query.eq("organisation_id", options.organisationId);
  if (options.venueId) query = query.eq("venue_id", options.venueId);
  if (options.mode === "auto") query = query.gt("deadline_at", new Date(now + HOUR).toISOString()).lte("deadline_at", new Date(now + 24 * HOUR).toISOString());
  const { data: periodRows, error } = await query.limit(50);
  if (error) throw error;
  const periods = ((periodRows ?? []) as Period[]).filter((period) => (options.mode === "auto" ? automaticReminderDue(period, now) : new Date(period.deadline_at).getTime() > now));
  const outcomes: (ReminderOutcome & { requestId: string })[] = [];

  for (const period of periods) {
    const config = await loadWhatsapp(period.organisation_id);
    if (options.mode === "auto" && !config) continue; // nothing can go out automatically without WhatsApp
    const { data: recipientRows } = await db.from("availability_request_recipients").select("id,staff_id,status,reminder_count,reminded_at").eq("organisation_id", period.organisation_id).eq("request_id", period.id);
    const due = ((recipientRows ?? []) as Recipient[]).filter((row) => remindable(row, options.mode, now));
    if (!due.length) continue;
    const [{ data: staffRows }, { data: venueRow }] = await Promise.all([
      db.from("staff_profiles").select("id,full_name,preferred_language,contact_phone,employment_status").eq("organisation_id", period.organisation_id).in("id", due.map((row) => row.staff_id)),
      db.from("venues").select("timezone").eq("organisation_id", period.organisation_id).eq("id", period.venue_id).single(),
    ]);
    const timezone = String((venueRow as { timezone?: string } | null)?.timezone || "Europe/Amsterdam");
    const people = new Map(((staffRows ?? []) as Person[]).map((person) => [person.id, person]));

    for (const recipient of due) {
      const person = people.get(recipient.staff_id);
      if (!person || person.employment_status === "deactivated") continue;
      const name = firstName(person.full_name);
      const language = person.preferred_language === "en" ? "en" : "nl";
      let phone: string | null = null;
      try { phone = person.contact_phone ? normalizeDutchPhone(person.contact_phone) : null; } catch { phone = null; }
      if (!phone) { outcomes.push({ requestId: period.id, staffId: person.id, name, state: "skipped", detail: "Geen geldig telefoonnummer." }); continue; }

      // The attempt row is the lock: the same reminder number can only be claimed once, even if two runs overlap.
      const attempt = recipient.reminder_count + 1;
      const channel = config ? "whatsapp_provider" : "manual_whatsapp";
      const { error: claimError } = await db.from("availability_message_attempts").insert({ organisation_id: period.organisation_id, venue_id: period.venue_id, recipient_id: recipient.id, attempt_type: "reminder", channel, idempotency_key: `reminder:${recipient.id}:${attempt}`, state: "prepared", attempted_by: options.actorId ?? null });
      if (claimError) { outcomes.push({ requestId: period.id, staffId: person.id, name, state: "skipped", detail: "Al herinnerd." }); continue; }

      const token = createAvailabilityToken();
      const { error: tokenError } = await db.from("secure_response_tokens").insert({ organisation_id: period.organisation_id, recipient_id: recipient.id, token_hash: hashAvailabilityToken(token), purpose: "availability", expires_at: period.deadline_at });
      if (tokenError) { outcomes.push({ requestId: period.id, staffId: person.id, name, state: "failed", detail: "Link maken lukte niet." }); continue; }
      const url = `${options.origin}/availability/${token}`;
      const nights = period.requested_dates?.length ? nightsLabel(period.requested_dates, language) : `${new Date(period.starts_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: timezone })} t/m ${new Date(period.ends_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: timezone })}`;
      const deadline = deadlineLabel(period.deadline_at, timezone, language);

      let outcome: ReminderOutcome;
      if (config) {
        // Same approved template as the first request; its text works as a reminder too.
        const result = await sendTemplate(config, phone, "availability", [name, nights, deadline, url]);
        outcome = result.ok ? { staffId: person.id, name, state: "sent", detail: "Herinnering verstuurd." } : { staffId: person.id, name, state: "failed", detail: result.detail };
        await db.from("availability_message_attempts").update({ state: result.ok ? "provider_accepted" : "failed", provider: "whatsapp_cloud", provider_message_id: result.ok ? result.messageId : null, failure_explanation: result.ok ? null : result.detail }).eq("organisation_id", period.organisation_id).eq("idempotency_key", `reminder:${recipient.id}:${attempt}`);
        await db.from("notification_outbox").insert({ organisation_id: period.organisation_id, venue_id: period.venue_id, channel: "whatsapp", destination_e164: phone, correlation_type: "availability_reminder", correlation_id: recipient.id, payload: { template: config.templates.availability, request_id: period.id, attempt }, state: result.ok ? "sent" : "failed", provider_message_id: result.ok ? result.messageId : null, failure_reason: result.ok ? null : result.detail });
        if (!result.ok) { outcomes.push({ requestId: period.id, ...outcome }); continue; }
      } else {
        const text = reminderMessage(language, name, nights, deadline, url);
        outcome = { staffId: person.id, name, state: "manual", detail: "Klaar om te versturen.", whatsappUrl: `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}` };
        await db.from("availability_message_attempts").update({ state: "manually_shared" }).eq("organisation_id", period.organisation_id).eq("idempotency_key", `reminder:${recipient.id}:${attempt}`);
      }
      await db.from("availability_request_recipients").update({ reminded_at: new Date(now).toISOString(), reminder_count: attempt }).eq("organisation_id", period.organisation_id).eq("id", recipient.id);
      outcomes.push({ requestId: period.id, ...outcome });
    }
  }
  return { requests: periods.length, sent: outcomes.filter((row) => row.state === "sent").length, outcomes };
}
