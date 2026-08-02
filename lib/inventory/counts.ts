export const FILL_SCALE = 10_000n;

export interface CountQuantity {
  packages: bigint;
  unitsPerPackage: bigint;
  completeUnits: bigint;
  partialFillBasisPoints: bigint;
}

export function exactCountQuantity(input: CountQuantity): bigint {
  if (input.packages < 0n || input.unitsPerPackage <= 0n || input.completeUnits < 0n) throw new Error("INVALID_COUNT_QUANTITY");
  if (input.partialFillBasisPoints < 0n || input.partialFillBasisPoints > FILL_SCALE) throw new Error("INVALID_FILL_BASIS_POINTS");
  return (input.packages * input.unitsPerPackage + input.completeUnits) * FILL_SCALE + input.partialFillBasisPoints;
}

export function fillBasisPoints(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n || numerator > denominator) throw new Error("INVALID_FILL_MEASUREMENT");
  return (numerator * FILL_SCALE) / denominator;
}

export interface ImageFingerprint {
  imageId: string;
  perceptualHash: bigint;
}

export function probableDuplicateImages(images: ImageFingerprint[], maximumHammingDistance = 4): string[][] {
  const groups: string[][] = [];
  const assigned = new Set<string>();
  for (const image of images) {
    if (assigned.has(image.imageId)) continue;
    const group = images
      .filter((candidate) => hammingDistance(image.perceptualHash, candidate.perceptualHash) <= maximumHammingDistance)
      .map(({ imageId }) => imageId);
    if (group.length > 1) {
      groups.push(group);
      group.forEach((id) => assigned.add(id));
    }
  }
  return groups;
}

function hammingDistance(left: bigint, right: bigint): number {
  let bits = left ^ right;
  let distance = 0;
  while (bits) {
    distance += Number(bits & 1n);
    bits >>= 1n;
  }
  return distance;
}
