import { describe, expect, it } from "vitest";
import {
  effectiveVersion,
  exceptionDedupeKey,
  preCloseIdempotencyKey,
  QUANTITY_SCALE,
  reconcileBeverage,
  varianceBasisPoints,
  volumeComponentToStockUnits,
} from "../lib/reconciliation/beverage";

describe("beverage reconciliation", () => {
  it("calculates actual, theoretical, explained and unexplained usage exactly", () => {
    const result = reconcileBeverage({
      opening: 100n * QUANTITY_SCALE,
      receipts: [{ quantity: 20n * QUANTITY_SCALE }],
      transfersIn: [{ quantity: 5n * QUANTITY_SCALE }],
      transfersOut: [{ quantity: 3n * QUANTITY_SCALE }],
      closing: 70n * QUANTITY_SCALE,
      nonSale: [
        { kind: "breakage", quantity: 1n * QUANTITY_SCALE },
        { kind: "complimentary", quantity: 2n * QUANTITY_SCALE },
      ],
      recipeUsage: [{ soldQuantity: 45n * QUANTITY_SCALE, componentQuantity: 1n * QUANTITY_SCALE }],
      revenueLines: [{ soldQuantity: 45n * QUANTITY_SCALE, unitPriceMinor: 900n }],
      registeredPosRevenueMinor: 40_500n,
      paymentRevenueMinor: 40_400n,
      applicableCostMinorPerUnit: 240n,
    });
    expect(result.actualUsage).toBe(49n * QUANTITY_SCALE);
    expect(result.theoreticalUsage).toBe(45n * QUANTITY_SCALE);
    expect(result.explainedUsage.breakage).toBe(1n * QUANTITY_SCALE);
    expect(result.unexplainedQuantityVariance).toBe(4n * QUANTITY_SCALE);
    expect(result.unexplainedCostVarianceMinor).toBe(960n);
    expect(result.expectedRegisteredRevenueMinor).toBe(40_500n);
    expect(result.revenueDifferenceMinor).toBe(0n);
  });

  it("uses historical cost and selling-price versions effective for the trading period", () => {
    const versions = [
      { effectiveAt: "2026-01-01T00:00:00Z", value: { costMinor: 200n, priceMinor: 800n } },
      { effectiveAt: "2026-08-01T00:00:00Z", value: { costMinor: 240n, priceMinor: 900n } },
    ];
    expect(effectiveVersion(versions, "2026-07-28T23:00:00Z").value).toEqual({ costMinor: 200n, priceMinor: 800n });
  });

  it("creates stable pre-close and exception idempotency keys", () => {
    expect(preCloseIdempotencyKey("org", "venue", "2026-07-28")).toBe(preCloseIdempotencyKey("org", "venue", "2026-07-28"));
    expect(exceptionDedupeKey("org", "venue", "2026-07-28", "material_variance", "product")).toBe(
      exceptionDedupeKey("org", "venue", "2026-07-28", "material_variance", "product"),
    );
  });

  it("returns no percentage for a zero theoretical denominator", () => {
    expect(varianceBasisPoints(10n, 0n)).toBeNull();
  });

  it("normalizes millilitre recipe components to exact stock units", () => {
    expect(volumeComponentToStockUnits(50n * QUANTITY_SCALE, 700n * QUANTITY_SCALE)).toBe(71_429n);
    expect(() => volumeComponentToStockUnits(50n * QUANTITY_SCALE, 0n)).toThrow("INVALID_DENOMINATOR");
  });

  it("rounds positive and negative financial boundaries symmetrically", () => {
    const base = {
      opening: 0n, receipts: [], transfersIn: [], transfersOut: [], closing: 0n, nonSale: [],
      recipeUsage: [], registeredPosRevenueMinor: 0n, paymentRevenueMinor: null, applicableCostMinorPerUnit: 0n,
    };
    expect(reconcileBeverage({...base,revenueLines:[{soldQuantity:500_000n,unitPriceMinor:1n}]}).expectedRegisteredRevenueMinor).toBe(1n);
    expect(reconcileBeverage({...base,revenueLines:[{soldQuantity:-500_000n,unitPriceMinor:1n}]}).expectedRegisteredRevenueMinor).toBe(-1n);
  });
});
