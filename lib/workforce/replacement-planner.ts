export type ReplacementCandidate = {
  staffId: string;
  name: string;
  hourlyCostMinor: bigint;
  eligible: boolean;
  maxWorkMinutes?: number;
  availability: { startsAt: string; endsAt: string }[];
};

export type ReplacementSegment = {
  staff_id: string;
  staff_name: string;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  hourly_cost_minor: string;
};

export type ReplacementPlan = {
  complete: boolean;
  segments: ReplacementSegment[];
  uncoveredFrom: string | null;
  plannedCostMinor: bigint;
};

/** Deterministic, explainable preview. The database repeats every eligibility check. */
export function planReplacementSegments(
  shift: { startsAt: string; endsAt: string; breakMinutes: number },
  candidates: ReplacementCandidate[],
  maxSegments = 4,
): ReplacementPlan {
  const start = new Date(shift.startsAt).getTime();
  const end = new Date(shift.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || maxSegments < 1) {
    return { complete: false, segments: [], uncoveredFrom: shift.startsAt, plannedCostMinor: 0n };
  }

  let cursor = start;
  const segments: ReplacementSegment[] = [];
  const usedMinutes = new Map<string, number>();
  while (cursor < end && segments.length < maxSegments) {
    const options = candidates
      .filter((candidate) => candidate.eligible)
      .flatMap((candidate) =>
        candidate.availability
          .map((window) => {
            const remaining = candidate.maxWorkMinutes == null ? Number.POSITIVE_INFINITY : Math.max(0, candidate.maxWorkMinutes - (usedMinutes.get(candidate.staffId) ?? 0));
            return { candidate, starts: new Date(window.startsAt).getTime(), ends: Math.min(new Date(window.endsAt).getTime(), cursor + remaining * 60_000) };
          })
          .filter((window) => Number.isFinite(window.starts) && Number.isFinite(window.ends) && window.starts <= cursor && window.ends > cursor),
      )
      .sort((left, right) =>
        right.ends - left.ends ||
        Number(left.candidate.hourlyCostMinor - right.candidate.hourlyCostMinor) ||
        left.candidate.staffId.localeCompare(right.candidate.staffId),
      );
    const chosen = options[0];
    if (!chosen) break;
    const segmentEnd = Math.min(chosen.ends, end);
    segments.push({
      staff_id: chosen.candidate.staffId,
      staff_name: chosen.candidate.name,
      starts_at: new Date(cursor).toISOString(),
      ends_at: new Date(segmentEnd).toISOString(),
      break_minutes: 0,
      hourly_cost_minor: chosen.candidate.hourlyCostMinor.toString(),
    });
    usedMinutes.set(chosen.candidate.staffId,(usedMinutes.get(chosen.candidate.staffId)??0)+Math.floor((segmentEnd-cursor)/60_000));
    cursor = segmentEnd;
  }

  if (cursor < end) return { complete: false, segments, uncoveredFrom: new Date(cursor).toISOString(), plannedCostMinor: 0n };
  if (shift.breakMinutes > 0) {
    const longest = segments.reduce((best, segment, index) => {
      const duration = new Date(segment.ends_at).getTime() - new Date(segment.starts_at).getTime();
      return duration > best.duration ? { index, duration } : best;
    }, { index: 0, duration: -1 });
    if (shift.breakMinutes * 60_000 > longest.duration) {
      return { complete: false, segments, uncoveredFrom: shift.startsAt, plannedCostMinor: 0n };
    }
    segments[longest.index].break_minutes = shift.breakMinutes;
  }
  const plannedCostMinor = segments.reduce((sum, segment) => {
    const minutes = Math.max(0, Math.floor((new Date(segment.ends_at).getTime() - new Date(segment.starts_at).getTime()) / 60_000) - segment.break_minutes);
    return sum + (BigInt(segment.hourly_cost_minor) * BigInt(minutes) + 30n) / 60n;
  }, 0n);
  return { complete: true, segments, uncoveredFrom: null, plannedCostMinor };
}
