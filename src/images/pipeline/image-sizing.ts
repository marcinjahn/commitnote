export function fitWithin(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return {
    width: width === longEdge ? maxLongEdge : Math.max(1, Math.round(width * scale)),
    height: height === longEdge ? maxLongEdge : Math.max(1, Math.round(height * scale)),
  };
}
