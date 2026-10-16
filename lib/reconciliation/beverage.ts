export const QUANTITY_SCALE = 1_000_000n;

export type NonSaleKind =
  | "waste" | "breakage" | "complimentary" | "staff_consumption"
  | "sampling" | "preparation" | "approved_correction";

export interface QuantityMovement {
  quantity: bigint;
}

export interface NonSaleMovement extends QuantityMovement {
  kind: NonSaleKind;
}

export interface SaleRecipeUsage {
  soldQuantity: bigint;
  componentQuantity: bigint;
}

export interface RevenueLine {
  soldQuantity: bigint;
  unitPriceMinor: bigint;
}

export interface BeverageReconciliationInput {
  opening: bigint;
  receipts: QuantityMovement[];
  transfersIn: QuantityMovement[];
  transfersOut: QuantityMovement[];
  closing: bigint;
  nonSale: NonSaleMovement[];
  recipeUsage: SaleRecipeUsage[];
  revenueLines: RevenueLine[];
  registeredPosRevenueMinor: bigint;
  paymentRevenueMinor: bigint | null;
  applicableCostMinorPerUnit: bigint;
}

export interface BeverageReconciliationResult {
  actualUsage: bigint;
  theoreticalUsage: bigint;
  explainedUsage: Record<NonSaleKind, bigint>;
  unexplainedQuantityVariance: bigint;
  unexplainedCostVarianceMinor: bigint;
  expectedRegisteredRevenueMinor: bigint;
  registeredPosRevenueMinor: bigint;
  paymentRevenueMinor: bigint | null;
  revenueDifferenceMinor: bigint;
}

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("INVALID_DENOMINATOR");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}
const scaledMultiply = (left: bigint, right: bigint) => divideRounded(left * right, QUANTITY_SCALE);

export function volumeComponentToStockUnits(componentVolumeMl: bigint, productUnitVolumeMl: bigint): bigint {
  return divideRounded(componentVolumeMl * QUANTITY_SCALE, productUnitVolumeMl);
}

export function varianceBasisPoints(variance: bigint, theoretical: bigint): bigint | null {
  if (theoretical === 0n) return null;
  return divideRounded(variance * 10_000n, theoretical);
}

export function reconcileBeverage(input: BeverageReconciliationInput): BeverageReconciliationResult {
  const explainedUsage = {
    waste: 0n,
    breakage: 0n,
    complimentary: 0n,
    staff_consumption: 0n,
    sampling: 0n,
    preparation: 0n,
    approved_correction: 0n,
  } satisfies Record<NonSaleKind, bigint>;
  for (const movement of input.nonSale) explainedUsage[movement.kind] += movement.quantity;
  const nonSaleTotal = sum(Object.values(explainedUsage));
  const actualUsage = input.opening
    + sum(input.receipts.map(({ quantity }) => quantity))
    + sum(input.transfersIn.map(({ quantity }) => quantity))
    - sum(input.transfersOut.map(({ quantity }) => quantity))
    - input.closing
    - nonSaleTotal;
  const theoreticalUsage = sum(input.recipeUsage.map((line) => scaledMultiply(line.soldQuantity, line.componentQuantity)));
  const unexplainedQuantityVariance = actualUsage - theoreticalUsage;
  const expectedRegisteredRevenueMinor = sum(input.revenueLines.map((line) => scaledMultiply(line.soldQuantity, line.unitPriceMinor)));
  const revenueDifferenceMinor = input.registeredPosRevenueMinor - expectedRegisteredRevenueMinor;
  return {
    actualUsage,
    theoreticalUsage,
    explainedUsage,
    unexplainedQuantityVariance,
    unexplainedCostVarianceMinor: scaledMultiply(unexplainedQuantityVariance, input.applicableCostMinorPerUnit),
    expectedRegisteredRevenueMinor,
    registeredPosRevenueMinor: input.registeredPosRevenueMinor,
    paymentRevenueMinor: input.paymentRevenueMinor,
    revenueDifferenceMinor,
  };
}

export interface EffectiveVersion<T> {
  effectiveAt: string;
  value: T;
}

export function effectiveVersion<T>(versions: EffectiveVersion<T>[], at: string): EffectiveVersion<T> {
  const selected = versions
    .filter((version) => version.effectiveAt <= at)
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0];
  if (!selected) throw new Error("MISSING_EFFECTIVE_VERSION");
  return selected;
}

export function exceptionDedupeKey(
  organisationId: string,
  venueId: string,
  tradingDate: string,
  exceptionType: string,
  subjectId: string,
): string {
  return [organisationId, venueId, tradingDate, exceptionType, subjectId].join(":");
}

export function preCloseIdempotencyKey(organisationId: string, venueId: string, tradingDate: string): string {
  return `${organisationId}:${venueId}:${tradingDate}:pre_close`;
}
