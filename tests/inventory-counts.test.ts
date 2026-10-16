import { describe, expect, it } from "vitest";
import { exactCountQuantity, fillBasisPoints, probableDuplicateImages } from "../lib/inventory/counts";
import { bottleDetectionProposalSchema, detectionRequiresConfirmation } from "../lib/inventory/vision-contract";

describe("inventory count domain", () => {
  it("converts packages, bottles and partial fill exactly", () => {
    expect(exactCountQuantity({ packages: 2n, unitsPerPackage: 6n, completeUnits: 3n, partialFillBasisPoints: 2_500n })).toBe(152_500n);
  });

  it("calculates calibrated fill basis points without floating point", () => {
    expect(fillBasisPoints(375n, 750n)).toBe(5_000n);
  });

  it("groups probable duplicate images with a bounded Hamming distance", () => {
    expect(probableDuplicateImages([
      { imageId: "a", perceptualHash: 0b101010n },
      { imageId: "b", perceptualHash: 0b101011n },
      { imageId: "c", perceptualHash: 0b010101n },
    ], 1)).toEqual([["a", "b"]]);
  });

  it("requires review for low-confidence or opaque proposals", () => {
    const proposal = bottleDetectionProposalSchema.parse({
      detectionId: "11111111-1111-4111-8111-111111111111",
      imageId: "22222222-2222-4222-8222-222222222222",
      boundingRegion: { xBasisPoints: 100, yBasisPoints: 100, widthBasisPoints: 2000, heightBasisPoints: 8000 },
      productCandidateIds: [],
      selectedProductId: null,
      bottleState: "unknown",
      fillBasisPoints: null,
      recognitionConfidenceBasisPoints: 4_000,
      fillConfidenceBasisPoints: null,
      occlusionWarning: false,
      reflectionWarning: false,
      opaqueContainerWarning: true,
      duplicateGroup: null,
      model: "fixture",
      modelVersion: "1",
      schemaVersion: "bottle-detection-v1",
    });
    expect(detectionRequiresConfirmation(proposal, {
      productThresholdBasisPoints: 8_000,
      fillThresholdBasisPoints: 8_000,
      financiallyMaterial: false,
      similarSkus: false,
    })).toBe(true);
  });
});
