/** Helpers for the per-person rooster grid. */
/** Oproepkrachten are stored as engagement_type "temporary". */
export const isOnCall = (person: { engagement_type?: string | null }) => person.engagement_type === "temporary";
/** The time most open slots of a night start/end at: what a one-click "plan" uses. */
export function mainSlotKey(slots: { starts_at: string; ends_at: string; staff_id: string | null }[]) {
  const counts = new Map<string, number>();
  for (const slot of slots) counts.set(`${slot.starts_at}|${slot.ends_at}`, (counts.get(`${slot.starts_at}|${slot.ends_at}`) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}
/** Which open slot a one-click plan takes: the standard time first, then the latest-starting other open slot. */
export function pickOpenSlot<T extends { id: string; starts_at: string; ends_at: string; staff_id: string | null }>(slots: T[]): T | undefined {
  const open = slots.filter((slot) => !slot.staff_id);
  if (!open.length) return undefined;
  const main = mainSlotKey(slots);
  return open.find((slot) => `${slot.starts_at}|${slot.ends_at}` === main) ?? [...open].sort((a, b) => b.starts_at.localeCompare(a.starts_at) || a.id.localeCompare(b.id))[0];
}
