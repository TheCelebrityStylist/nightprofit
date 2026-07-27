const datePart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  Number(parts.find((part) => part.type === type)?.value);

export function venueTradingDate(
  timestamp: string | Date,
  timezone: string,
  cutoffHour: number,
): string {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new Error("INVALID_TRADING_CUTOFF");
  }
  const instant = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(instant.getTime())) throw new Error("INVALID_TIMESTAMP");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(instant);
  const year = datePart(parts, "year");
  const month = datePart(parts, "month");
  const day = datePart(parts, "day");
  const hour = datePart(parts, "hour");
  const localNoonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  if (hour < cutoffHour) localNoonUtc.setUTCDate(localNoonUtc.getUTCDate() - 1);
  return localNoonUtc.toISOString().slice(0, 10);
}
