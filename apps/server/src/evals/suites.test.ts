import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { buildSuites, commonParent, suiteKey, type SuiteRun } from './suites';

const run = (
  id: string,
  startedAt: string,
  plugin: string,
  dir: string,
  cases: Record<string, number | { score: number; without?: number; cost?: number; withoutCost?: number }>,
  model: string | null = 'm',
): SuiteRun => ({
  id,
  startedAt,
  model,
  plugin,
  caseDirs: Object.keys(cases).map((n) => `${dir}/${n}`),
  cases: Object.entries(cases).map(([name, v]) => ({
    name,
    score: typeof v === 'number' ? v : v.score,
    costUsd: typeof v === 'number' ? undefined : v.cost,
    without:
      typeof v === 'number' || v.without === undefined ? undefined : { score: v.without, costUsd: v.withoutCost },
  })),
});
const main = (id: string, t: string, cases: Parameters<typeof run>[4], model?: string | null) =>
  run(id, `2026-10-${t}:00.000Z`, 'plug', 'evals/cases', cases, model);
const bare = (id: string, t: string, cases: Parameters<typeof run>[4], model?: string | null) =>
  run(id, `2026-10-${t}:00.000Z`, 'naked', 'evals/bare', cases, model);

const only = <T>(xs: T[]) => {
  expect(xs).toHaveLength(1);
  return xs[0] as T;
};
const caseOf = (inputs: SuiteRun[], name: string) =>
  only(buildSuites(inputs, 'plug').filter((s) => s.kind === 'main'))
    .cases.find((c) => c.name === name)!;

describe('suite keys', () => {
  it('uses plugin name and the common parent of the case dirs', () => {
    expect(commonParent(['evals/cases/a', 'evals/cases/b'])).toBe('evals/cases');
    expect(commonParent(['evals/a/x', 'evals/b/y'])).toBe('evals');
    expect(commonParent(['a'])).toBe('');
    expect(commonParent([])).toBe('');
    expect(suiteKey(bare('r', '01T10:00', { a: 1 }))).toBe('naked · evals/bare');
    expect(suiteKey({ ...bare('r', '01T10:00', { a: 1 }), caseDirs: [] })).toBe('naked');
    expect(suiteKey({ id: 'r', model: null, caseDirs: [], cases: [] })).toBe('unknown');
  });
});

describe('buildSuites', () => {
  it('carries tokens, duration, pass rate and the commit to the run rows', () => {
    const r = main('m', '02T10:00', { a: 1 });
    const c = caseOf(
      [{ ...r, commit: 'abc', cases: r.cases.map((x) => ({ ...x, tokens: 10, durationMs: 2000, passRate: 0.5 })) }],
      'a',
    );
    expect(c.latest).toMatchObject({ tokens: 10, durationMs: 2000, passRate: 0.5, commit: 'abc' });
  });

  it('skips runs without cases', () => {
    expect(buildSuites([run('e', '2026-10-01T10:00:00.000Z', 'p', 'evals/c', {})], 'p')).toEqual([]);
  });

  it('classifies main, baseline and other suites; main first', () => {
    const suites = buildSuites(
      [
        bare('b', '01T10:00', { a: 0.5 }),
        run('o', '2026-10-03T10:00:00.000Z', 'other', 'evals/o', { zzz: 1 }),
        main('m', '02T10:00', { a: 1, b: 1 }),
      ],
      'plug',
    );
    expect(suites.map((s) => [s.key, s.kind])).toEqual([
      ['plug · evals/cases', 'main'],
      ['naked · evals/bare', 'baseline'],
      ['other · evals/o', 'other'],
    ]);
    expect(suites[0]?.cases.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('treats every suite as main without a plugin name (no baselines)', () => {
    const suites = buildSuites([bare('b', '01T10:00', { a: 0.5 }), main('m', '02T10:00', { a: 1 })]);
    expect(suites.map((s) => s.kind)).toEqual(['other', 'other']);
  });

  it('picks the latest same-model baseline that started before the run', () => {
    const c = caseOf(
      [
        bare('b1', '01T10:00', { a: 0.2 }),
        bare('b2', '02T10:00', { a: 0.4 }),
        bare('b3', '04T10:00', { a: 0.9 }),
        bare('bx', '02T12:00', { a: 0.7 }, 'other-model'),
        main('m', '03T10:00', { a: 1 }),
      ],
      'a',
    );
    const s = only(c.sections);
    expect(s.kind).toBe('run');
    expect(s.baseline).toMatchObject({ runId: 'b2', score: 0.4, after: false, model: 'm' });
    expect(s.runs[0]).toMatchObject({ runId: 'm', baselineScore: 0.4 });
    expect(s.runs[0]?.delta).toBeCloseTo(0.6);
    expect(c.latest.delta).toBeCloseTo(0.6);
  });

  it('falls back to the nearest later baseline, marked after, and splits sections by it', () => {
    const c = caseOf(
      [
        bare('b1', '05T10:00', { a: 0.5 }),
        bare('b2', '08T10:00', { a: 0.1 }),
        main('early', '01T10:00', { a: 1 }),
        main('late', '06T10:00', { a: 0.75 }),
      ],
      'a',
    );
    expect(c.sections.map((s) => [s.baseline?.runId, s.baseline?.after, s.runs.map((r) => r.runId)])).toEqual([
      ['b1', false, ['late']],
      ['b1', true, ['early']],
    ]);
  });

  it('ignores baselines of another model or case; no baseline goes to the none section', () => {
    const inputs = [
      bare('b', '01T10:00', { a: 0.5 }, 'other-model'),
      main('m', '02T10:00', { a: 1, solo: 1 }),
    ];
    const none = only(caseOf(inputs, 'a').sections);
    expect(none.kind).toBe('none');
    expect(none.baseline).toBeUndefined();
    expect(only(caseOf(inputs, 'solo').sections).runs[0]?.delta).toBeUndefined();
  });

  it('uses the own without arm as baseline over any baseline run, in one ablation section', () => {
    const c = caseOf(
      [
        bare('b', '01T10:00', { a: 0.5 }),
        main('ab1', '02T10:00', { a: { score: 1, without: 0.25 } }),
        main('ab2', '03T10:00', { a: { score: 0.5, without: 0.5 } }),
        main('plain', '04T10:00', { a: 1 }),
      ],
      'a',
    );
    expect(c.sections.map((s) => [s.kind, s.runs.map((r) => [r.runId, r.baselineScore])])).toEqual([
      ['run', [['plain', 0.5]]],
      ['ablation', [['ab2', 0.5], ['ab1', 0.25]]],
    ]);
  });

  it('summarizes the case: counts, newest run, trend oldest first, unscored runs skipped in the trend', () => {
    const inputs = [main('m3', '03T10:00', { a: 0.9 }), main('m1', '01T10:00', { a: 0.1 }), main('m2', '02T10:00', { a: 0.5 })];
    inputs[1]!.cases[0]!.score = undefined;
    const c = caseOf(inputs, 'a');
    expect(c).toMatchObject({ runCount: 3, lastRunAt: '2026-10-03T10:00:00.000Z', trend: [0.5, 0.9] });
    expect(c.latest.runId).toBe('m3');
  });

  it('keeps the last 12 scores', () => {
    const inputs = Array.from({ length: 15 }, (_, i) => main(`m${i}`, `${String(i + 1).padStart(2, '0')}T10:00`, { a: i / 20 }));
    expect(caseOf(inputs, 'a').trend).toHaveLength(12);
    expect(caseOf(inputs, 'a').trend[11]).toBeCloseTo(0.7);
  });

  it('dedupes a result copy (same start and suite), preferring the run dir', () => {
    const inputs = [
      main('plugin.json', '02T10:00', { a: 1 }),
      main('2026-10-02T10-00-00-000Z', '02T10:00', { a: 1 }),
      main('other', '03T10:00', { a: 1 }),
    ];
    const s = only(buildSuites(inputs, 'plug'));
    expect(s.runCount).toBe(2);
    expect(s.cases[0]?.sections.flatMap((x) => x.runs.map((r) => r.runId)).sort()).toEqual([
      '2026-10-02T10-00-00-000Z',
      'other',
    ]);
  });

  it('skips undated runs', () => {
    expect(buildSuites([{ ...main('m', '01T10:00', { a: 1 }), startedAt: undefined }], 'plug')).toEqual([]);
  });
});

describe('baseline metrics', () => {
  it('come from the own without arm, else from the matched baseline run', () => {
    const ab = caseOf([main('m', '03T10:00', { a: { score: 1, cost: 2, without: 0.5, withoutCost: 1 } })], 'a');
    expect(ab.latest.baselineMetrics).toEqual({ score: 0.5, costUsd: 1 });
    const base = bare('b', '02T10:00', { a: { score: 0.4, cost: 3 } });
    const rb = caseOf([base, main('m', '03T10:00', { a: { score: 1, cost: 2 } })], 'a');
    expect(rb.latest.baselineMetrics).toMatchObject({ score: 0.4, costUsd: 3 });
    expect(caseOf([main('m', '03T10:00', { a: 1 })], 'a').latest.baselineMetrics).toBeUndefined();
  });
});

describe('pinned baselines', () => {
  const inputs = [
    bare('b', '01T10:00', { a: 0.2 }),
    main('old', '02T10:00', { a: 0.5 }),
    main('new', '03T10:00', { a: 1 }),
  ];
  const caseWith = (pins: Record<string, string>) =>
    only(buildSuites(inputs, 'plug', pins).filter((s) => s.kind === 'main')).cases[0]!;

  it('uses a pinned main-suite run instead of the auto baseline', () => {
    const c = caseWith({ a: 'old' });
    expect(c.stalePin).toBeUndefined();
    const s = only(c.sections);
    expect(s.baseline).toMatchObject({ runId: 'old', score: 0.5, pinned: true });
    expect(s.runs.map((r) => [r.runId, r.pinned, r.baselineScore])).toEqual([
      ['new', undefined, 0.5],
      ['old', true, 0.5],
    ]);
    expect(c.latest.baselineMetrics).toMatchObject({ score: 0.5 });
  });

  it('beats the ablation arm', () => {
    const abl = [main('old', '02T10:00', { a: 0.5 }), main('new', '03T10:00', { a: { score: 1, without: 0.1 } })];
    expect(caseOf(abl, 'a').sections.map((x) => x.kind)).toContain('ablation');
    const pinned = only(buildSuites(abl, 'plug', { a: 'old' })).cases[0]!;
    expect(only(pinned.sections).baseline?.runId).toBe('old');
  });

  it('flags a pin whose run is missing and falls back to the auto baseline', () => {
    const c = caseWith({ a: 'gone' });
    expect(c.stalePin).toBe('gone');
    expect(only(c.sections).baseline).toMatchObject({ runId: 'b' });
    expect(only(c.sections).baseline?.pinned).toBeUndefined();
  });

  it('without a pin behaves as before', () => {
    const c = caseWith({});
    expect(c.stalePin).toBeUndefined();
    expect(c.latest.pinned).toBeUndefined();
    expect(only(c.sections).baseline?.runId).toBe('b');
  });
});

describe('reference labels', () => {
  it('label runs per case without touching the baseline', () => {
    const c = only(
      buildSuites([bare('b', '01T10:00', { a: 0.2 }), main('m1', '02T10:00', { a: 0.5 }), main('m2', '03T10:00', { a: 1 })], 'plug', {}, {
        a: [{ label: 'sonnet', runId: 'm1' }, { label: 'bare', runId: 'b' }],
      }).filter((s) => s.kind === 'main'),
    ).cases[0]!;
    const rows = Object.fromEntries(c.sections.flatMap((s) => s.runs).map((r) => [r.runId, r]));
    expect(rows['m1']?.refs).toEqual(['sonnet']);
    expect(rows['m2']?.refs).toBeUndefined();
    expect(c.sections[0]?.baseline?.runId).toBe('b');
    expect(c.stalePin).toBeUndefined();
  });
});

describe('PUT /evals/baseline', () => {
  it('sets, replaces and unsets a pin in config.json, keeping other keys', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pm-pin-'));
    const space = join(tmp, 'plug');
    await mkdir(join(space, '.plugin-master'), { recursive: true });
    await writeFile(join(space, '.plugin-master/config.json'), JSON.stringify({ masterContext: ['x'], evalTrusted: true }));
    const app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'h') });
    const headers = { authorization: 'Bearer t' };
    try {
      const { id } = (await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path: space, name: 'plug' } })).json();
      const put = (payload: object) => app.inject({ method: 'PUT', url: `/api/spaces/${id}/evals/baseline`, headers, payload });
      const read = async () => JSON.parse(await readFile(join(space, '.plugin-master/config.json'), 'utf8'));
      expect((await put({ case: 'a', runId: 'r1' })).statusCode).toBe(200);
      await put({ case: 'b', runId: 'r2' });
      await put({ case: 'a', runId: 'r3' });
      expect(await read()).toMatchObject({ masterContext: ['x'], evalTrusted: true, evalBaselines: { a: 'r3', b: 'r2' } });
      await put({ case: 'a', runId: null });
      expect((await read()).evalBaselines).toEqual({ b: 'r2' });
      expect((await put({ case: '', runId: 'r' })).statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      await app.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('GET /evals/suites', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pm-suites-'));
  });
  afterEach(() => rm(tmp, { recursive: true, force: true }));

  const result = (plugin: string, dir: string, startedAt: string, score: number, extra = {}) => ({
    schemaVersion: 1,
    startedAt,
    suite: { modelOverride: 'm', plugins: [{ name: plugin }] },
    cases: [
      {
        name: 'a',
        dir: `${dir}/a`,
        aggregates: { score },
        arms: { with: [{ score, turns: 3, costUsd: 0.5, judgeCostUsd: 0.25, graders: [], passed: true, durationSeconds: 4, ...extra }], without: [] },
      },
    ],
    aggregates: {},
  });

  it('builds suites from result dirs and top-level files (harness `metrics` field tolerated)', async () => {
    const space = join(tmp, 'plug');
    await mkdir(join(space, '.claude-plugin'), { recursive: true });
    await writeFile(join(space, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'plug' }));
    const put = async (rel: string, data: unknown) => {
      await mkdir(join(space, rel, '..'), { recursive: true });
      await writeFile(join(space, rel), JSON.stringify(data));
    };
    const m = result('plug', 'evals/cases', '2026-10-02T10:00:00.000Z', 1);
    await put('evals/results/2026-10-02T10-00-00-000Z/aggregate-result.json', m);
    await put('evals/results/2026-10-02T10-00-00-000Z/pm-meta.json', {
      commit: 'abc123', tree: 't', dirty: false, spaceId: 's', startedAt: '2026-10-02T10:00:00.000Z',
    });
    await put('evals/results/plugin.json', m); // copy of the last run
    await put('evals/results/bare.json', result('naked', 'evals/bare', '2026-10-01T10:00:00.000Z', 0.5, { metrics: { recall: 1 } }));
    await put('evals/results/bad/aggregate-result.json', {});
    const app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'h') });
    const headers = { authorization: 'Bearer t' };
    try {
      const { id } = (
        await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path: space, name: 'plug' } })
      ).json();
      const res = (await app.inject({ url: `/api/spaces/${id}/evals/suites`, headers })).json();
      expect(res.dir).toBe('evals');
      expect(res.suites.map((s: { key: string; kind: string; runCount: number }) => [s.key, s.kind, s.runCount])).toEqual([
        ['plug · evals/cases', 'main', 1],
        ['naked · evals/bare', 'baseline', 1],
      ]);
      const c = res.suites[0].cases[0];
      expect(c.latest).toMatchObject({ runId: '2026-10-02T10-00-00-000Z', score: 1, turns: 3, costUsd: 0.75, baselineScore: 0.5, delta: 0.5 });
      expect(c.latest).toMatchObject({ durationMs: 4000, passRate: 1 });
      expect(c.latest.commit).toBe('abc123');
      expect(c.latest.tokens).toBeUndefined();
      // metrics of the baseline run (`bare.json`)
      expect(c.latest.baselineMetrics).toMatchObject({ score: 0.5, passRate: 1, costUsd: 0.75, turns: 3, durationMs: 4000 });
      expect(c.latest.baselineMetrics?.tokens).toBeUndefined();
      expect(c.sections[0].baseline).toMatchObject({ runId: 'bare.json', after: false });
      expect((await app.inject({ url: '/api/spaces/nope/evals/suites', headers })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('duplicate copies', () => {
  it('keeps retrieval metrics of the dropped copy on the run dir', () => {
    const run = (id: string, extra = {}): SuiteRun => ({
      id,
      startedAt: '2026-01-01T00:00:00.000Z',
      model: null,
      plugin: 'p',
      caseDirs: ['evals/cases/a'],
      cases: [{ name: 'a', score: 1, ...extra }],
    });
    const [suite] = buildSuites([run('plugin.json', { recall: 0.5, precision: 1, f1: 0.67 }), run('2026-01-01T00-00-00-000Z')]);
    expect(suite?.cases[0]?.latest).toMatchObject({ runId: '2026-01-01T00-00-00-000Z', recall: 0.5, precision: 1, f1: 0.67 });
  });
});
