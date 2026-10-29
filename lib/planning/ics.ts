/** Minimal iCalendar (RFC 5545) writer for a personal shift feed. */
export type CalendarEvent = { uid: string; start: string; end: string; summary: string; location?: string; description?: string; cancelled?: boolean; sequence?: number; updated?: string; alarmMinutes?: number };

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets continue on the next line with a leading space. */
export function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (size + length > (parts.length ? 74 : 75)) { parts.push(current); current = ""; size = 0; }
    current += char; size += length;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildCalendar(name: string, events: CalendarEvent[], now = new Date().toISOString()) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cliniq Team//Rooster//NL", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`, "X-WR-TIMEZONE:Europe/Amsterdam", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp(event.updated ?? now)}`,
      `DTSTART:${stamp(event.start)}`,
      `DTEND:${stamp(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
      ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
      `SEQUENCE:${event.sequence ?? 0}`,
      `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      ...(event.alarmMinutes && !event.cancelled ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(event.summary)}`, `TRIGGER:-PT${Math.round(event.alarmMinutes)}M`, "END:VALARM"] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
