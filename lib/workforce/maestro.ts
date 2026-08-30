export type AvailabilityState =
  | "available"
  | "preferred"
  | "preferably_not"
  | "unavailable"
  | "unknown";

export type SchedulingCandidate = {
  staffId: string;
  hourlyCostMinor: bigint;
  contractedMinutes: number;
  alreadyPlannedMinutes: number;
  availability: AvailabilityState;
  eligible: boolean;
};

export type RosterObjective = "balanced" | "lowest_cost" | "preference";

export function shiftMinutes(startsAt: string, endsAt: string, breakMinutes: number) {
  const elapsed = Math.floor(
    (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000,
  );
  if (
    !Number.isFinite(elapsed) ||
    elapsed <= 0 ||
    !Number.isInteger(breakMinutes) ||
    breakMinutes < 0 ||
    breakMinutes >= elapsed
  )
    throw new Error("Invalid shift duration");
  return elapsed - breakMinutes;
}

export function supplementedLaborCostMinor(
  minutes: number,
  hourlyCostMinor: bigint,
  supplementBasisPoints = 0,
) {
  if (
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    hourlyCostMinor < 0n ||
    !Number.isInteger(supplementBasisPoints) ||
    supplementBasisPoints < 0 ||
    supplementBasisPoints > 100_000
  )
    throw new Error("Invalid labor input");
  const base = (BigInt(minutes) * hourlyCostMinor + 30n) / 60n;
  const supplement =
    (base * BigInt(supplementBasisPoints) + 5_000n) / 10_000n;
  return { baseMinor: base, supplementMinor: supplement, totalMinor: base + supplement };
}

export function laborPercentageBasisPoints(laborMinor: bigint, revenueMinor: bigint) {
  if (laborMinor < 0n || revenueMinor < 0n) throw new Error("Invalid financial input");
  if (revenueMinor === 0n) return null;
  return Number((laborMinor * 10_000n + revenueMinor / 2n) / revenueMinor);
}

export function serviceTradingDate(startsAt: string, timeZone: string, cutoffHour = 8) {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23)
    throw new Error("Invalid cutoff");
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid service start");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const local = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  if (value("hour") < cutoffHour) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

export function selectReminderRecipients<T extends { status: string; active: boolean; optedOut: boolean }>(
  recipients: readonly T[],
) {
  const excluded = new Set([
    "responded",
    "submitted",
    "cancelled",
    "expired",
    "revoked",
    "provider_accepted",
  ]);
  return recipients.filter(
    (recipient) => recipient.active && !recipient.optedOut && !excluded.has(recipient.status),
  );
}

const availabilityRank: Record<AvailabilityState, number> = {
  preferred: 0,
  available: 1,
  preferably_not: 2,
  unknown: 3,
  unavailable: 4,
};

export function rankSchedulingCandidates(
  candidates: readonly SchedulingCandidate[],
  objective: RosterObjective,
) {
  return candidates
    .filter(
      (candidate) =>
        candidate.eligible &&
        candidate.availability !== "unavailable" &&
        candidate.availability !== "unknown",
    )
    .toSorted((left, right) => {
      if (objective === "lowest_cost") {
        const cost = left.hourlyCostMinor - right.hourlyCostMinor;
        if (cost !== 0n) return cost < 0n ? -1 : 1;
      }
      if (objective === "preference") {
        const preference =
          availabilityRank[left.availability] - availabilityRank[right.availability];
        if (preference) return preference;
      }
      const leftDeviation = Math.abs(
        left.contractedMinutes - left.alreadyPlannedMinutes,
      );
      const rightDeviation = Math.abs(
        right.contractedMinutes - right.alreadyPlannedMinutes,
      );
      if (leftDeviation !== rightDeviation) return rightDeviation - leftDeviation;
      return left.staffId.localeCompare(right.staffId);
    });
}

export function availabilityConflicts(
  shiftStart: string,
  shiftEnd: string,
  windows: readonly { startsAt: string; endsAt: string; state: AvailabilityState }[],
) {
  const start = new Date(shiftStart).getTime();
  const end = new Date(shiftEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error("Invalid shift window");
  const overlaps = windows.filter(
    (window) =>
      new Date(window.startsAt).getTime() < end &&
      new Date(window.endsAt).getTime() > start,
  );
  if (!overlaps.length) return ["unknown"] as AvailabilityState[];
  return [...new Set(overlaps.map((window) => window.state))];
}
