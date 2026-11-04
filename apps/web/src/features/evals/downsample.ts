/**
 * At most `max` points of a long series: consecutive buckets of equal size, each represented by
 * its largest item (so peaks stay visible), with the index range it covers. Shorter series pass
 * through one item per point.
 */
export function maxPerBucket<T>(
  items: T[],
  value: (t: T) => number,
  max = 150,
): { item: T; from: number; to: number }[] {
  const size = Math.max(1, Math.ceil(items.length / max));
  const out: { item: T; from: number; to: number }[] = [];
  for (let from = 0; from < items.length; from += size) {
    const to = Math.min(from + size, items.length) - 1;
    let best = from;
    for (let i = from + 1; i <= to; i++)
      if (value(items[i]) > value(items[best])) best = i;
    out.push({ item: items[best], from, to });
  }
  return out;
}
