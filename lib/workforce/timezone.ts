const parts = (date: Date, timeZone: string) => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
);

export function utcToZonedInput(value: string, timeZone: string) {
  const valueParts = parts(new Date(value), timeZone);
  return `${valueParts.year}-${valueParts.month}-${valueParts.day}T${valueParts.hour}:${valueParts.minute}`;
}

export function zonedInputToUtc(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("INVALID_LOCAL_DATE_TIME");
  const naive = new Date(`${value}:00.000Z`);
  let candidate = naive;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateParts = parts(candidate, timeZone);
    const represented = Date.UTC(
      Number(candidateParts.year), Number(candidateParts.month) - 1, Number(candidateParts.day),
      Number(candidateParts.hour), Number(candidateParts.minute), Number(candidateParts.second),
    );
    candidate = new Date(candidate.getTime() - (represented - naive.getTime()));
  }
  if (utcToZonedInput(candidate.toISOString(), timeZone) !== value) throw new Error("NON_EXISTENT_LOCAL_DATE_TIME");
  return candidate.toISOString();
}
