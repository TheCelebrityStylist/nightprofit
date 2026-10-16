// Deterministic roster rules. Mirrors public.roster_paid_minutes and
// public.roster_shift_cost_minor in the database; integer arithmetic only.

export type IsoDate = string; // YYYY-MM-DD

const DAY_MS = 86_400_000;

export function isIsoDate(value: string): value is IsoDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const base = Date.parse(`${date}T12:00:00Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday (ISO week start) of the week containing `date`. */
export function weekStartOf(date: IsoDate): IsoDate {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function weekDays(weekStart: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function isoWeekNumber(date: IsoDate): number {
  const target = new Date(`${date}T12:00:00Z`);
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4, 12));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

/** Today's calendar date in a venue's time zone. */
export function todayIn(timezone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function offsetMinutes(instantMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60_000);
}

/** Convert a venue-local wall-clock date/time to a UTC ISO instant (DST-safe). */
export function localToInstant(date: IsoDate, time: string, timezone: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !isIsoDate(date)) throw new Error("INVALID_LOCAL_TIME");
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  let instant = wall - offsetMinutes(wall, timezone) * 60_000;
  instant = wall - offsetMinutes(instant, timezone) * 60_000;
  return new Date(instant).toISOString();
}

/** Shift window for a service date. An end time at or before the start runs into the next day. */
export function shiftWindow(serviceDate: IsoDate, start: string, end: string, timezone: string) {
  const startsAt = localToInstant(serviceDate, start, timezone);
  let endsAt = localToInstant(serviceDate, end, timezone);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) endsAt = localToInstant(addDays(serviceDate, 1), end, timezone);
  return { startsAt, endsAt };
}

export function localTime(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

export function paidMinutes(startsAt: string, endsAt: string, breakMinutes: number): number {
  const totalSeconds = Math.floor(Date.parse(endsAt) / 1000) - Math.floor(Date.parse(startsAt) / 1000);
  return Math.floor(totalSeconds / 60) - breakMinutes;
}

/** paid minutes × hourly cost ÷ 60, rounded half up. */
export function shiftCostMinor(minutes: number | bigint, hourlyCostMinor: number | bigint): bigint {
  const m = BigInt(minutes);
  const rate = BigInt(hourlyCostMinor);
  return (m * rate * 2n + 60n) / 120n;
}

export function formatMinor(minor: bigint | number | string, currency = "EUR", locale = "nl-NL"): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  const wholeText = new Intl.NumberFormat(locale, { useGrouping: true }).format(whole);
  const symbol = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currency;
  const separator = locale.startsWith("nl") ? "," : ".";
  return `${negative ? "-" : ""}${symbol} ${wholeText}${separator}${cents}`;
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}u${String(rest).padStart(2, "0")}` : `${hours}u`;
}

export type RosterShiftLike = {
  id: string;
  employee_id: string | null;
  service_date: IsoDate;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  hourly_cost_minor: number | string;
  status: "scheduled" | "cancelled";
};
export type AvailabilityLike = { employee_id: string; service_date: IsoDate; status: "available" | "preferred" | "unavailable" };
export type LeaveLike = { employee_id: string; kind: "leave" | "sick" | "other"; starts_on: IsoDate; ends_on: IsoDate; status: "requested" | "approved" | "rejected" };

export function overlaps(a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }) {
  return Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at);
}

export function leaveOn(leave: LeaveLike[], employeeId: string, date: IsoDate) {
  return leave.find((item) => item.employee_id === employeeId && item.status !== "rejected" && item.starts_on <= date && item.ends_on >= date);
}

export type ShiftWarning = "unavailable" | "on_leave" | "leave_requested" | "overlap";

export function shiftWarnings(
  shift: Pick<RosterShiftLike, "id" | "employee_id" | "service_date" | "starts_at" | "ends_at">,
  context: { shifts: RosterShiftLike[]; availability: AvailabilityLike[]; leave: LeaveLike[] },
): ShiftWarning[] {
  if (!shift.employee_id) return [];
  const warnings: ShiftWarning[] = [];
  const availability = context.availability.find((item) => item.employee_id === shift.employee_id && item.service_date === shift.service_date);
  if (availability?.status === "unavailable") warnings.push("unavailable");
  const leave = leaveOn(context.leave, shift.employee_id, shift.service_date);
  if (leave?.status === "approved") warnings.push("on_leave");
  else if (leave?.status === "requested") warnings.push("leave_requested");
  if (context.shifts.some((other) => other.id !== shift.id && other.status === "scheduled" && other.employee_id === shift.employee_id && overlaps(other, shift))) warnings.push("overlap");
  return warnings;
}

export type Candidate = { employeeId: string; score: number; availability: AvailabilityLike["status"] | "unknown"; weekMinutes: number; contractMinutes: number | null };

/**
 * Rank who can take a shift. Excludes people on approved leave/sick, marked
 * unavailable or already working an overlapping shift. Preferred beats
 * available beats unknown; within a group, most remaining contract hours first.
 */
export function rankCandidates(
  shift: Pick<RosterShiftLike, "id" | "service_date" | "starts_at" | "ends_at">,
  employees: { id: string; active: boolean; contract_minutes_week: number | null }[],
  context: { shifts: RosterShiftLike[]; availability: AvailabilityLike[]; leave: LeaveLike[] },
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const employee of employees) {
    if (!employee.active) continue;
    const leave = leaveOn(context.leave, employee.id, shift.service_date);
    if (leave?.status === "approved") continue;
    const availability = context.availability.find((item) => item.employee_id === employee.id && item.service_date === shift.service_date)?.status ?? "unknown";
    if (availability === "unavailable") continue;
    const mine = context.shifts.filter((other) => other.employee_id === employee.id && other.status === "scheduled" && other.id !== shift.id);
    if (mine.some((other) => overlaps(other, shift))) continue;
    const weekMinutes = mine.reduce((sum, other) => sum + paidMinutes(other.starts_at, other.ends_at, other.break_minutes), 0);
    const base = availability === "preferred" ? 3000 : availability === "available" ? 2000 : 1000;
    const remaining = employee.contract_minutes_week === null ? 0 : Math.max(-600, Math.min(600, Math.round((employee.contract_minutes_week - weekMinutes) / 10)));
    const leavePenalty = leave?.status === "requested" ? 500 : 0;
    candidates.push({ employeeId: employee.id, score: base + remaining - leavePenalty, availability, weekMinutes, contractMinutes: employee.contract_minutes_week });
  }
  return candidates.sort((a, b) => b.score - a.score || a.weekMinutes - b.weekMinutes || a.employeeId.localeCompare(b.employeeId));
}

/** Normalise a phone number for a wa.me link. Dutch 06 numbers become +316. */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `31${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function whatsappLink(phone: string | null, message: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}
