function floorLog2(value: number): number {
  let result = Math.max(0, Math.floor(Math.log2(value)));
  while (2 ** (result + 1) <= value) result += 1;
  while (2 ** result > value) result -= 1;
  return result;
}

export function padmeLength(length: number): number {
  if (length < 2) return length;
  const exponent = floorLog2(length);
  const significantBits = floorLog2(exponent) + 1;
  const unit = 2 ** (exponent - significantBits);
  return Math.ceil(length / unit) * unit;
}
