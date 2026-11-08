/** Array element that must exist; throws instead of an unchecked cast. */
export function at<T>(items: readonly T[], index: number): T {
  const v = items[index];
  if (v === undefined) throw new RangeError(`No element at index ${index}`);
  return v;
}
