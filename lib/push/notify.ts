/** The moments staff get a phone notification. Every function is best-effort: a failed push never blocks the planner. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushToStaff } from "./push";

const HOUR = 3600_000;
const clock = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone });

/** "Je dienst begint om 23:00": once per shift, for shifts starting 2 to 3 hours from now. Run hourly. */
export async function remindUpcomingShifts(db: SupabaseClient, origin: string, now = Date.now()) {
  const { data: subscriptionRows } = await db.from("push_subscriptions").select("organisation_id,staff_id");
  const subscribed = new Set(((subscriptionRows ?? []) as { organisation_id: string; staff_id: string }[]).map((row) => `${row.organisation_id}|${row.staff_id}`));
  if (!subscribed.size) return 0;
  const { data: shiftRows } = await db.from("shifts").select("id,organisation_id,venue_id,staff_id,starts_at,ends_at,status").eq("status", "published").not("staff_id", "is", null).gte("starts_at", new Date(now + 2 * HOUR).toISOString()).lt("starts_at", new Date(now + 3 * HOUR).toISOString()).limit(500);
  const shifts = ((shiftRows ?? []) as { id: string; organisation_id: string; venue_id: string; staff_id: string; starts_at: string; ends_at: string }[]).filter((row) => subscribed.has(`${row.organisation_id}|${row.staff_id}`));
  if (!shifts.length) return 0;
  const { data: venueRows } = await db.from("venues").select("id,name,timezone").in("id", [...new Set(shifts.map((row) => row.venue_id))]);
  const venues = new Map(((venueRows ?? []) as { id: string; name: string; timezone: string | null }[]).map((row) => [row.id, row]));
  let sent = 0;
  for (const shift of shifts) {
    const { error } = await db.from("push_deliveries").insert({ key: `shift-start:${shift.id}:${shift.starts_at}`, organisation_id: shift.organisation_id });
    if (error) continue; // already told
    const venue = venues.get(shift.venue_id);
    const tz = venue?.timezone || "Europe/Amsterdam";
    const reached = await pushToStaff(db, shift.organisation_id, [shift.staff_id], { title: `Je dienst begint om ${clock(shift.starts_at, tz)}`, body: `${venue?.name ?? "Werk"}, ${clock(shift.starts_at, tz)} – ${clock(shift.ends_at, tz)}.`, url: "/app/my-work", tag: `shift-${shift.id}` }, origin);
    if (reached.size) sent += 1;
  }
  return sent;
}

/** After publishing: everyone with a shift in the week hears that their rooster is ready. */
export async function announceRoster(db: SupabaseClient, organisationId: string, venueId: string, windowStart: string, windowEnd: string, weekNumber: number, origin: string) {
  const { data } = await db.from("shifts").select("staff_id").eq("organisation_id", organisationId).eq("venue_id", venueId).eq("status", "published").not("staff_id", "is", null).gte("starts_at", windowStart).lt("starts_at", windowEnd);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { staff_id: string }[]) counts.set(row.staff_id, (counts.get(row.staff_id) ?? 0) + 1);
  if (!counts.size) return 0;
  const reached = await pushToStaff(db, organisationId, [...counts.keys()], (staffId) => {
    const count = counts.get(staffId) ?? 0;
    return { title: `Je rooster voor week ${weekNumber} staat klaar`, body: `${count} ${count === 1 ? "dienst" : "diensten"}. Tik om te kijken.`, url: "/app/my-work", tag: `roster-${venueId}-${windowStart}` };
  }, origin);
  return reached.size;
}
