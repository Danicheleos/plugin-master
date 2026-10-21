import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EvalSuiteCase, EvalSuiteEntry } from '@pm/protocol';
import { buildApp } from '../app';
import { aggregateRuns, mapCases, nameInMatch } from './targets';

const kase = (name: string, extra: Partial<EvalSuiteCase> = {}): EvalSuiteCase => ({
  name,
  dir: `evals/${name}`,
  tags: [],
  ...extra,
});
const SK = ['alpha', 'alpha-extra', 'beta'];
const AG = ['reviewer'];

describe('nameInMatch', () => {
  it('extracts plain names and ignores complex patterns', () => {
    expect(nameInMatch('"skill"\\s*:\\s*"(?:[\\w-]+:)?alpha"')).toBe('alpha');
    expect(nameInMatch('"subagent_type":"reviewer"')).toBe('reviewer');
    expect(nameInMatch('plug:beta')).toBe('beta');
    expect(nameInMatch('beta')).toBe('beta');
    expect(nameInMatch('(a|b)')).toBeUndefined();
    expect(nameInMatch('.*')).toBeUndefined();
  });
});

describe('mapCases', () => {
  it('maps by graders, tags, name fallback, else unmapped', () => {
    const m = mapCases(
      [
        kase('g1', { toolGraders: [{ tool: 'Skill', inputMatch: '"skill"\\s*:\\s*"(?:[\\w-]+:)?beta"' }] }),
        kase('g2', { toolGraders: [{ tool: 'Task', inputMatch: 'reviewer' }, { tool: 'Skill', inputMatch: '(x|y)' }] }),
        kase('g3', { toolGraders: [{ tool: 'Agent', inputMatch: 'Explore' }] }), // not a plugin agent
        kase('t1', { tags: ['skill:gamma', 'agent:reviewer', 'smoke'] }),
        kase('alpha-extra-triggers'),
        kase('alpha-basic'),
        kase('x', { dir: 'evals/beta/x' }),
        kase('beta', { tags: ['skill:alpha'] }), // tag beats the name fallback
        kase('other'),
      ],
      SK,
      AG,
    );
    const by = (kind: string, name: string) => m.targets.find((t) => t.kind === kind && t.name === name)?.cases;
    expect(by('skill', 'beta')).toEqual(['g1']);
    expect(by('agent', 'reviewer')).toEqual(['g2', 't1']);
    expect(by('skill', 'gamma')).toEqual(['t1']);
    expect(by('skill', 'alpha-extra')).toEqual(['alpha-extra-triggers']);
    expect(by('skill', 'alpha')).toEqual(['alpha-basic', 'beta']);
    expect(m.unmapped).toEqual(['g3', 'x', 'other']);
  });

  it('falls back to the case dir name', () => {
    expect(mapCases([kase('c', { dir: 'evals/beta' })], SK, AG).targets[0]).toMatchObject({ name: 'beta' });
  });
});

describe('aggregateRuns', () => {
  const row = (runId: string, startedAt: string, score: number, extra = {}) => ({ runId, startedAt, model: 'm', score, ...extra });
  const entry = (name: string, runs: ReturnType<typeof row>[]) => ({
    name,
    runCount: runs.length,
    latest: runs[0],
    trend: [],
    sections: [{ kind: 'none' as const, runs }],
  });
  const suites = [
    {
      key: 'p',
      label: 'p',
      kind: 'main',
      runCount: 2,
      cases: [
        entry('a', [row('r2', '2026-10-02T00:00:00Z', 1, { costUsd: 2, maxContext: 10, baselineMetrics: { score: 0.5 } }), row('r1', '2026-10-01T00:00:00Z', 0.5)]),
        entry('b', [row('r2', '2026-10-02T00:00:00Z', 0.5, { costUsd: 4, maxContext: 30, baselineMetrics: { score: 0.25 } })]),
        entry('c', [row('r2', '2026-10-02T00:00:00Z', 0)]),
      ],
    },
  ] as unknown as EvalSuiteEntry[];

  it('means per run (max for maxContext), newest first, only the given cases', () => {
    const runs = aggregateRuns(suites, ['a', 'b']);
    expect(runs.map((r) => r.runId)).toEqual(['r2', 'r1']);
    expect(runs[0]).toMatchObject({ score: 0.75, costUsd: 3, maxContext: 30, baselineScore: 0.375, delta: 0.375 });
    expect(runs[0]?.baselineMetrics).toEqual({ score: 0.375 });
    expect(runs[1]?.baselineMetrics).toBeUndefined();
  });

  it('takes runs of a case that only a baseline suite has, but not baseline copies of main cases', () => {
    const all = [
      ...suites,
      { key: 'n', label: 'n', kind: 'baseline', runCount: 2, cases: [entry('a', [row('b1', '2026-10-03T00:00:00Z', 0.1)]), entry('z', [row('b2', '2026-10-03T00:00:00Z', 0.9)])] },
    ] as unknown as EvalSuiteEntry[];
    expect(aggregateRuns(all, ['a']).map((r) => r.runId)).toEqual(['r2', 'r1']);
    expect(aggregateRuns(all, ['z']).map((r) => r.runId)).toEqual(['b2']);
  });
});

describe('GET /evals/targets', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pm-targets-'));
  });
  afterEach(() => rm(tmp, { recursive: true, force: true }));

  it('maps suite cases to skills with context bytes and run series', async () => {
    const space = join(tmp, 'plug');
    const put = async (rel: string, data: string) => {
      await mkdir(join(space, rel, '..'), { recursive: true });
      await writeFile(join(space, rel), data);
    };
    await put('.claude-plugin/plugin.json', JSON.stringify({ name: 'plug' }));
    await put('skills/alpha/SKILL.md', '---\nname: alpha\ndescription: abc\n---\n12345');
    await put('evals/cases/c1/prompt.md', '---\nname: c1\n---\nhi');
    await put('evals/cases/c1/graders/s.md', '---\ntype: tool_used\ntool: Skill\ninput_match: alpha\n---\n');
    await put('evals/cases/c2/case.yaml', 'name: c2\n');
    const startedAt = '2026-10-02T10:00:00.000Z';
    await put(
      'evals/results/r1/aggregate-result.json',
      JSON.stringify({
        schemaVersion: 1,
        startedAt,
        suite: { modelOverride: 'm', plugins: [{ name: 'plug' }] },
        cases: ['c1', 'c2', 'c3'].map((name, i) => ({
          name,
          dir: `evals/cases/${name}`,
          aggregates: { score: i },
          arms: { with: [{ score: i, turns: 2, costUsd: 1, graders: [], passed: true }], without: [] },
        })),
        aggregates: {},
      }),
    );
    const app = buildApp({ port: 0, webOrigins: [], token: 't', home: join(tmp, 'h') });
    const headers = { authorization: 'Bearer t' };
    try {
      const { id } = (await app.inject({ method: 'POST', url: '/api/spaces', headers, payload: { path: space, name: 'plug' } })).json();
      const res = (await app.inject({ url: `/api/spaces/${id}/evals/targets`, headers })).json();
      expect(res.targets).toHaveLength(1);
      expect(res.targets[0]).toMatchObject({ kind: 'skill', name: 'alpha', cases: [{ name: 'c1', lastRunId: 'r1' }], contextBytes: 3 + 5 });
      expect(res.targets[0].runs[0]).toMatchObject({ runId: 'r1', score: 0, turns: 2 });
      // c3 has runs but no case file: listed as unmapped, not dropped
      expect(res.unmapped).toMatchObject({ cases: [{ name: 'c2', lastRunId: 'r1' }, { name: 'c3', lastRunId: 'r1' }] });
      expect(res.unmapped.runs[0]).toMatchObject({ score: 1.5 });
      expect((await app.inject({ url: '/api/spaces/nope/evals/targets', headers })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
