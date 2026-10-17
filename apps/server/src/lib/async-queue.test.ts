import { describe, expect, it } from 'vitest';
import { AsyncQueue } from './async-queue';

describe('AsyncQueue', () => {
  it('yields pushed items in order, also when pushed before and after iteration starts', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const seen: number[] = [];
    const done = (async () => {
      for await (const n of q) seen.push(n);
    })();
    q.push(2);
    q.push(3);
    q.end();
    await done;
    expect(seen).toEqual([1, 2, 3]);
  });
});
