import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readExternalSeries } from './external';
import { listGroups, loadRuns } from './results';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

const sample = (over: Record<string, unknown> = {}) => ({
  kind: 'eval-series',
  series: 's1',
  arm: 'plugin',
  startedAt: ago(10 * MIN),
  updatedAt: ago(MIN),
  finishedAt: null,
  runsPerCase: 3,
  total: 2,
  done: 1,
  current: 'b',
  costUsd: 0.4,
  cases: [
    { name: 'a', state: 'done', score: 0.8, costUsd: 0.4 },
    { name: 'b', state: 'running', score: null, costUsd: null },
  ],
  ...over,
});

let space: string;
let tmp: string;
const put = (v: unknown) =>
  writeFile(join(space, 'evals/results/running.json'), typeof v === 'string' ? v : JSON.stringify(v));

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-ext-'));
  space = join(tmp, 'plug');
  await mkdir(join(space, 'evals/results'), { recursive: true });
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

describe('external series', () => {
  it('returns a live series', async () => {
    await put(sample());
    expect(await readExternalSeries(space, NOW)).toMatchObject({ series: 's1', done: 1, total: 2 });
  });

  it('returns null when the file is missing', async () => {
    expect(await readExternalSeries(space, NOW)).toBeNull();
  });

  it('returns null for invalid json or a wrong shape', async () => {
    await put('{bad');
    expect(await readExternalSeries(space, NOW)).toBeNull();
    await put(sample({ kind: 'other' }));
    expect(await readExternalSeries(space, NOW)).toBeNull();
    await put(sample({ total: 'x' }));
    expect(await readExternalSeries(space, NOW)).toBeNull();
  });

  it('keeps a series finished within 2 minutes, drops an older one', async () => {
    await put(sample({ finishedAt: ago(MIN) }));
    expect(await readExternalSeries(space, NOW)).not.toBeNull();
    await put(sample({ finishedAt: ago(3 * MIN) }));
    expect(await readExternalSeries(space, NOW)).toBeNull();
  });

  it('drops a series not updated for 30 minutes', async () => {
    await put(sample({ updatedAt: ago(29 * MIN) }));
    expect(await readExternalSeries(space, NOW)).not.toBeNull();
    await put(sample({ updatedAt: ago(31 * MIN) }));
    expect(await readExternalSeries(space, NOW)).toBeNull();
  });

  it('is not listed as a run (no schemaVersion)', async () => {
    await put(sample());
    await mkdir(join(space, 'evals/results/a'));
    await cp(join(__dirname, '__fixtures__/passing.json'), join(space, 'evals/results/a/aggregate-result.json'));
    expect((await loadRuns(space)).map((r) => r.summary.id)).toEqual(['a']);
    expect((await listGroups(space)).flatMap((g) => g.runIds)).toEqual(['a']);
  });
});
