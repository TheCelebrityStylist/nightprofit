export type CoverageRequirement = {
  id: string;
  startsAt: string;
  endsAt: string;
  roleId: string;
  requiredStaff: number;
  expectedRevenueMinor: bigint;
};

export type CoverageShift = {
  id: string;
  startsAt: string;
  endsAt: string;
  roleId: string;
  staffId: string | null;
  hourlyCostMinor: bigint;
  breakMinutes: number;
  locked?: boolean;
};

export type CoverageInterval = CoverageRequirement & {
  plannedStaff: number;
  gap: number;
  overstaffing: number;
  plannedCostMinor: bigint;
  laborBasisPoints: number | null;
};

export type ConstraintShift = { id: string; staffId: string | null; startsAt: string; endsAt: string; breakMinutes: number };
export type ConstraintStaff = { id: string; maximumMinutes: number | null };

const minutesBetween = (startsAt: string, endsAt: string) => {
  const minutes = Math.floor((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error("INVALID_INTERVAL");
  return minutes;
};

export function analyzeRosterConstraints(shifts: readonly ConstraintShift[], staff: readonly ConstraintStaff[]) {
  let overlaps=0,restViolations=0,maximumMinutesViolations=0;
  const minutesByStaff=new Map<string,number>();
  for(const person of staff){
    const assigned=shifts.filter(shift=>shift.staffId===person.id).toSorted((left,right)=>new Date(left.startsAt).getTime()-new Date(right.startsAt).getTime());
    let previous:ConstraintShift|undefined;
    for(const shift of assigned){
      const minutes=minutesBetween(shift.startsAt,shift.endsAt)-shift.breakMinutes;
      if(minutes<0)throw new Error("INVALID_BREAK_DURATION");
      minutesByStaff.set(person.id,(minutesByStaff.get(person.id)??0)+minutes);
      if(previous){const rest=new Date(shift.startsAt).getTime()-new Date(previous.endsAt).getTime();if(rest<0)overlaps+=1;else if(rest<11*60*60_000)restViolations+=1;}
      if(!previous||new Date(shift.endsAt)>new Date(previous.endsAt))previous=shift;
    }
    if(person.maximumMinutes!==null&&(minutesByStaff.get(person.id)??0)>person.maximumMinutes)maximumMinutesViolations+=1;
  }
  return{overlaps,restViolations,maximumMinutesViolations,total:overlaps+restViolations+maximumMinutesViolations,minutesByStaff};
}

export function calculateCoverage(
  requirements: readonly CoverageRequirement[],
  shifts: readonly CoverageShift[],
): CoverageInterval[] {
  return requirements.map((requirement) => {
    if (!Number.isInteger(requirement.requiredStaff) || requirement.requiredStaff < 0)
      throw new Error("INVALID_REQUIREMENT");
    const start = new Date(requirement.startsAt).getTime();
    const end = new Date(requirement.endsAt).getTime();
    const intervalMinutes = minutesBetween(requirement.startsAt, requirement.endsAt);
    const matching = shifts.filter(
      (shift) =>
        shift.roleId === requirement.roleId &&
        shift.staffId !== null &&
        new Date(shift.startsAt).getTime() < end &&
        new Date(shift.endsAt).getTime() > start,
    );
    const plannedCostMinor = matching.reduce(
      (total, shift) => total + (shift.hourlyCostMinor * BigInt(intervalMinutes) + 30n) / 60n,
      0n,
    );
    return {
      ...requirement,
      plannedStaff: matching.length,
      gap: Math.max(0, requirement.requiredStaff - matching.length),
      overstaffing: Math.max(0, matching.length - requirement.requiredStaff),
      plannedCostMinor,
      laborBasisPoints:
        requirement.expectedRevenueMinor > 0n
          ? Number((plannedCostMinor * 10_000n + requirement.expectedRevenueMinor / 2n) / requirement.expectedRevenueMinor)
          : null,
    };
  });
}

export type HealthIssue = {
  dimension: "coverage" | "compliance" | "availability" | "skills" | "budget" | "hours" | "preference" | "breaks" | "evidence";
  severity: "blocking" | "warning" | "info";
  code: string;
  count: number;
  action: string;
};

export function rosterHealth(input: {
  coverage: readonly CoverageInterval[];
  hardConstraintViolations: number;
  availabilityConflicts: number;
  skillConflicts: number;
  laborBasisPoints: number | null;
  targetLaborBasisPoints: number | null;
  hourImbalances: number;
  preferenceMisses: number;
  breakConflicts: number;
  missingEvidence: readonly string[];
}) {
  const issues: HealthIssue[] = [];
  const gaps = input.coverage.reduce((total, interval) => total + interval.gap, 0);
  const overstaffed = input.coverage.reduce((total, interval) => total + interval.overstaffing, 0);
  if (gaps) issues.push({dimension:"coverage",severity:"blocking",code:"UNCOVERED_INTERVALS",count:gaps,action:"resolve_coverage"});
  if (overstaffed) issues.push({dimension:"coverage",severity:"warning",code:"OVERSTAFFED_INTERVALS",count:overstaffed,action:"review_overstaffing"});
  if (input.hardConstraintViolations) issues.push({dimension:"compliance",severity:"blocking",code:"HARD_CONSTRAINTS",count:input.hardConstraintViolations,action:"resolve_compliance"});
  if (input.availabilityConflicts) issues.push({dimension:"availability",severity:"blocking",code:"AVAILABILITY_CONFLICTS",count:input.availabilityConflicts,action:"reassign_shift"});
  if (input.skillConflicts) issues.push({dimension:"skills",severity:"blocking",code:"SKILL_CONFLICTS",count:input.skillConflicts,action:"reassign_shift"});
  if (input.laborBasisPoints !== null && input.targetLaborBasisPoints !== null && input.laborBasisPoints > input.targetLaborBasisPoints)
    issues.push({dimension:"budget",severity:"warning",code:"LABOR_TARGET_EXCEEDED",count:input.laborBasisPoints-input.targetLaborBasisPoints,action:"compare_proposals"});
  if (input.hourImbalances) issues.push({dimension:"hours",severity:"warning",code:"CONTRACT_HOUR_IMBALANCE",count:input.hourImbalances,action:"rebalance_hours"});
  if (input.preferenceMisses) issues.push({dimension:"preference",severity:"info",code:"PREFERENCE_MISSES",count:input.preferenceMisses,action:"compare_preference_plan"});
  if (input.breakConflicts) issues.push({dimension:"breaks",severity:"warning",code:"BREAK_COVERAGE_CONFLICTS",count:input.breakConflicts,action:"adjust_breaks"});
  if (input.missingEvidence.length) issues.push({dimension:"evidence",severity:"warning",code:"MISSING_EVIDENCE",count:input.missingEvidence.length,action:"complete_evidence"});
  return {
    publishable: !issues.some((issue) => issue.severity === "blocking"),
    dimensions: ["coverage","compliance","availability","skills","budget","hours","preference","breaks","evidence"] as const,
    issues,
  };
}

export function simulateDemand(
  coverage: readonly CoverageInterval[],
  demandChangeBasisPoints: number,
) {
  if (!Number.isInteger(demandChangeBasisPoints) || demandChangeBasisPoints < -10_000 || demandChangeBasisPoints > 100_000)
    throw new Error("INVALID_SCENARIO");
  return coverage.map((interval) => {
    const scaledRequired = Math.max(0, Math.ceil((interval.requiredStaff * (10_000 + demandChangeBasisPoints)) / 10_000));
    const scaledRevenue = (interval.expectedRevenueMinor * BigInt(10_000 + demandChangeBasisPoints) + 5_000n) / 10_000n;
    return {
      intervalId: interval.id,
      requiredStaff: scaledRequired,
      requiredStaffChange: scaledRequired - interval.requiredStaff,
      gap: Math.max(0, scaledRequired - interval.plannedStaff),
      expectedRevenueMinor: scaledRevenue,
      laborBasisPoints: scaledRevenue > 0n ? Number((interval.plannedCostMinor * 10_000n + scaledRevenue / 2n) / scaledRevenue) : null,
    };
  });
}

export type ReplacementCandidate = {
  staffId: string;
  eligible: boolean;
  available: boolean;
  restCompliant: boolean;
  skillsValid: boolean;
  projectedMinutes: number;
  maximumMinutes: number | null;
  costDifferenceMinor: bigint;
  preferred: boolean;
};

export function rankReplacements(candidates: readonly ReplacementCandidate[]) {
  return candidates
    .filter((candidate) =>
      candidate.eligible && candidate.available && candidate.restCompliant && candidate.skillsValid &&
      (candidate.maximumMinutes === null || candidate.projectedMinutes <= candidate.maximumMinutes))
    .toSorted((left, right) => {
      if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
      if (left.costDifferenceMinor !== right.costDifferenceMinor) return left.costDifferenceMinor < right.costDifferenceMinor ? -1 : 1;
      if (left.projectedMinutes !== right.projectedMinutes) return left.projectedMinutes - right.projectedMinutes;
      return left.staffId.localeCompare(right.staffId);
    });
}

export type ApprovedTimeLine = {
  staffId: string;
  workedMinutes: number;
  hourlyCostMinor: bigint;
  supplementBasisPoints: number;
  approved: boolean;
};

export function payrollReadyTotals(lines: readonly ApprovedTimeLine[]) {
  if (lines.some((line) => !line.approved)) throw new Error("UNAPPROVED_HOURS");
  return lines.map((line) => {
    if (!Number.isInteger(line.workedMinutes) || line.workedMinutes < 0 || line.hourlyCostMinor < 0n || !Number.isInteger(line.supplementBasisPoints) || line.supplementBasisPoints < 0)
      throw new Error("INVALID_PAYROLL_LINE");
    const baseMinor = (BigInt(line.workedMinutes) * line.hourlyCostMinor + 30n) / 60n;
    const supplementMinor = (baseMinor * BigInt(line.supplementBasisPoints) + 5_000n) / 10_000n;
    return {...line, baseMinor, supplementMinor, totalMinor: baseMinor + supplementMinor};
  });
}
