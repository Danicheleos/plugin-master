import { describe, expect, it } from 'vitest';
import { maxPerBucket } from './downsample';

describe('maxPerBucket', () => {
  it('passes a short series through', () => {
    expect(maxPerBucket([3, 1], (x) => x, 5)).toEqual([
      { item: 3, from: 0, to: 0 },
      { item: 1, from: 1, to: 1 },
    ]);
    expect(maxPerBucket([], (x: number) => x)).toEqual([]);
  });

  it('keeps at most max points and the peak of each bucket', () => {
    const xs = Array.from({ length: 5000 }, (_, i) =>
      i === 2345 ? 1e6 : i % 7,
    );
    const out = maxPerBucket(xs, (x) => x, 150);
    expect(out.length).toBeLessThanOrEqual(150);
    expect(out.map((p) => p.item)).toContain(1e6);
    expect(out[0].from).toBe(0);
    expect(out.at(-1)?.to).toBe(4999);
    expect(maxPerBucket([1, 5, 2, 0, 9], (x) => x, 2)).toEqual([
      { item: 5, from: 0, to: 2 },
      { item: 9, from: 3, to: 4 },
    ]);
  });
});
