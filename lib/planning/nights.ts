/** Small helpers shared by the planner, the team views and the WhatsApp texts. */

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? "";

const parseDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

/** "do 22, vr 23 en za 24 okt" — a list of nights the way you'd say it in a message. */
export function nightsLabel(dates: string[], language: "nl" | "en" = "nl") {
  const intl = language === "nl" ? "nl-NL" : "en-GB";
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) return "";
  const groups: { month: string; days: string[] }[] = [];
  for (const value of sorted) {
    const date = parseDate(value);
    const month = date.toLocaleDateString(intl, { month: "short", timeZone: "UTC" }).replace(".", "");
    const day = `${date.toLocaleDateString(intl, { weekday: "short", timeZone: "UTC" }).replace(".", "")} ${date.getUTCDate()}`;
    const last = groups.at(-1);
    if (last && last.month === month) last.days.push(day);
    else groups.push({ month, days: [day] });
  }
  const parts = groups.flatMap((group) => group.days.map((day, index) => (index === group.days.length - 1 ? `${day} ${group.month}` : day)));
  const joiner = language === "nl" ? " en " : " and ";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}${joiner}${parts.at(-1)}`;
}

/** "wo 21 okt, 20:00" in the venue's time zone. */
export function deadlineLabel(iso: string, timeZone = "Europe/Amsterdam", language: "nl" | "en" = "nl") {
  return new Date(iso)
    .toLocaleString(language === "nl" ? "nl-NL" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone })
    .replace(/\./g, "");
}

/** The service date a shift or availability row belongs to: anything starting before noon counts for the night before. */
export function nightOf(iso: string, timeZone = "Europe/Amsterdam") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (Number(get("hour")) >= 12) return date;
  const previous = parseDate(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD) of the ISO week that contains the given date. */
export function mondayOf(date: string) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function isoWeekNumber(date: string) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = Date.UTC(value.getUTCFullYear(), 0, 1);
  return Math.ceil(((value.getTime() - yearStart) / 86400000 + 1) / 7);
}

/** UTC instant for a local wall-clock time in a time zone (DST-safe for whole minutes). */
export function zonedInstant(date: string, time: string, timeZone = "Europe/Amsterdam") {
  const [hour, minute] = time.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - instant;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first)).toISOString();
}
