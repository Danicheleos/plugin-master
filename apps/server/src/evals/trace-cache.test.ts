import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRun } from './results';
import { flushTraceCache, resetTraceCache, setTraceCacheHome } from './trace-cache';

const fx = (n: string) => join(__dirname, '__fixtures__', n);
let tmp: string;
let space: string;
let trace: string;

const metrics = async () => (await readRun(space, 'r1')).result.cases[0]?.arms.with[0]?.traceMetrics;
/** As after a restart: memory is gone, the disk file stays. */
const restart = async () => {
  await flushTraceCache();
  resetTraceCache();
};
const cacheFile = async () => join(tmp, 'home/cache', (await readdir(join(tmp, 'home/cache')))[0] as string);

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pm-tcache-'));
  space = join(tmp, 'plug');
  const dir = join(space, 'evals/results/r1');
  await mkdir(join(dir, 'traces/with'), { recursive: true });
  await cp(fx('two-arm.json'), join(dir, 'aggregate-result.json'));
  trace = join(dir, 'traces/with/delta-1.jsonl');
  await cp(fx('trace.jsonl'), trace);
  setTraceCacheHome(join(tmp, 'home'));
  resetTraceCache();
});
afterEach(async () => {
  await flushTraceCache(); // a pending timer would recreate the dir after rm
  setTraceCacheHome(undefined);
  resetTraceCache();
  await rm(tmp, { recursive: true, force: true });
});

describe('trace cache on disk', () => {
  it('serves unchanged traces from disk after a restart', async () => {
    const first = await metrics();
    expect(first?.modelCalls).toBe(3);
    await restart();
    // Unreadable but unchanged (stat still works): only the cache can answer.
    await chmod(trace, 0);
    expect(await metrics()).toEqual(first);
    expect(JSON.parse(await readFile(await cacheFile(), 'utf8')).version).toBe(1);
  });

  it('recomputes a changed trace', async () => {
    await metrics();
    await restart();
    const raw = await readFile(trace, 'utf8');
    await writeFile(trace, raw.split('\n').slice(0, 2).join('\n') + '\n');
    expect((await metrics())?.modelCalls).not.toBe(3);
  });

  it('ignores a corrupt or other-version cache file', async () => {
    await metrics();
    await restart();
    await writeFile(await cacheFile(), '{bad');
    expect((await metrics())?.modelCalls).toBe(3);
    await restart();
    await writeFile(await cacheFile(), JSON.stringify({ version: 99, files: { x: 1 } }));
    expect((await metrics())?.modelCalls).toBe(3);
  });

  it('recomputes the retrieval when truth.json changes', async () => {
    const truth = join(space, 'evals/cases/delta/truth.json');
    const recall = async () => (await readRun(space, 'r1')).result.cases[0]?.arms.with[0]?.metrics?.recall;
    await mkdir(join(truth, '..'), { recursive: true });
    await writeFile(truth, JSON.stringify({ relevant: ['a.ts'] }));
    expect(await recall()).toBe(0);
    await restart();
    await writeFile(truth, JSON.stringify({ relevant: [], source: 'citations' }));
    expect(await recall()).toBeNull();
  });

  it('works without a cache home', async () => {
    setTraceCacheHome(undefined);
    expect((await metrics())?.modelCalls).toBe(3);
  });
});
