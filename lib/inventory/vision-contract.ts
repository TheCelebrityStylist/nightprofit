import { z } from "zod";

const basisPoints = z.number().int().min(0).max(10_000);
const boundingRegion = z.object({
  xBasisPoints: basisPoints,
  yBasisPoints: basisPoints,
  widthBasisPoints: basisPoints,
  heightBasisPoints: basisPoints,
});

export const bottleDetectionProposalSchema = z.object({
  detectionId: z.string().uuid(),
  imageId: z.string().uuid(),
  boundingRegion,
  productCandidateIds: z.array(z.string().uuid()).max(10),
  selectedProductId: z.string().uuid().nullable(),
  bottleState: z.enum(["sealed", "open", "unknown"]),
  fillBasisPoints: basisPoints.nullable(),
  recognitionConfidenceBasisPoints: basisPoints,
  fillConfidenceBasisPoints: basisPoints.nullable(),
  occlusionWarning: z.boolean(),
  reflectionWarning: z.boolean(),
  opaqueContainerWarning: z.boolean(),
  duplicateGroup: z.string().nullable(),
  model: z.string().min(1),
  modelVersion: z.string().min(1),
  schemaVersion: z.literal("bottle-detection-v1"),
});

export type BottleDetectionProposal = z.infer<typeof bottleDetectionProposalSchema>;

export function detectionRequiresConfirmation(
  proposal: BottleDetectionProposal,
  options: { productThresholdBasisPoints: number; fillThresholdBasisPoints: number; financiallyMaterial: boolean; similarSkus: boolean },
): boolean {
  return proposal.recognitionConfidenceBasisPoints < options.productThresholdBasisPoints
    || proposal.fillConfidenceBasisPoints === null
    || proposal.fillConfidenceBasisPoints < options.fillThresholdBasisPoints
    || options.financiallyMaterial
    || options.similarSkus
    || proposal.opaqueContainerWarning
    || proposal.occlusionWarning
    || proposal.reflectionWarning
    || proposal.duplicateGroup !== null;
}

export interface VisionProvider {
  readonly key: string;
  configured(): boolean;
  analyzePrivateImages(input: { organisationId: string; venueId: string; signedImageUrls: string[] }): Promise<BottleDetectionProposal[]>;
}
