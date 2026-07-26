import { describe, expect, it } from "vitest";
import { actualCash, bottleYield, breakEvenRevenue, closeDifference, costPerServing, eventContribution, expectedCash, grossProfit, marginBasisPoints, netFromGross, payoutTiered, perUnit } from "../lib/calculations";

describe("financial calculation contract",()=>{
  it("reconciles cash in integer minor units",()=>{
    expect(expectedCash(30000n,225000n,5000n,12000n,80000n)).toBe(158000n);
    expect(actualCash([{valueMinor:5000n,quantity:24n},{valueMinor:2000n,quantity:19n}])).toBe(158000n);
    expect(closeDifference(157514n,158000n)).toBe(-486n);
  });
  it("separates VAT, profit and margin deterministically",()=>{
    expect(netFromGross(12100n,2100n)).toBe(10000n);
    expect(grossProfit(10000n,2800n)).toBe(7200n);
    expect(marginBasisPoints(7200n,10000n)).toBe(7200n);
  });
  it("calculates progressive organiser payout tiers",()=>{
    expect(payoutTiered(1200000n,[{from:0n,to:500000n,rateBps:1000n},{from:500000n,to:1000000n,rateBps:1500n},{from:1000000n,rateBps:2000n}])).toBe(165000n);
  });
  it("calculates beverage yield, serving cost and event contribution",()=>{
    expect(bottleYield(700n,40n)).toBe(17n);
    expect(costPerServing(3400n,17n)).toBe(200n);
    expect(eventContribution(1000000n,280000n,220000n,80000n)).toBe(420000n);
  });
  it("calculates break-even and per-visitor revenue",()=>{
    expect(breakEvenRevenue(300000n,6000n)).toBe(500000n);
    expect(perUnit(1684200n,720n)).toBe(2339n);
  });
});
