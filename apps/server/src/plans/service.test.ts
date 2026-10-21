import { FeaturesSchema } from '@pm/protocol';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlansService } from './service';

let root: string;
const notify = vi.fn();
let plans: ReturnType<typeof createPlansService>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-plans-'));
  await mkdir(join(root, '.plugin-master'));
  notify.mockClear();
  plans = createPlansService(root, notify);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const current = async () => {
  const c = await plans.current();
  if (!c) throw new Error('no active plan');
  return c;
};

describe('plans service', () => {
  it('creates a plan, activates the first one only and persists under .plugin-master/plans', async () => {
    const a = await plans.create({ title: 'A', goal: 'ga' });
    const b = await plans.create({ title: 'B', goal: 'gb' });
    expect((await plans.list()).active).toBe(a.id);
    expect((await plans.list()).plans.map((p) => p.title)).toEqual(['A', 'B']);
    expect(await readdir(join(root, '.plugin-master/plans'))).toHaveLength(2);
    await plans.setActive(b.id);
    expect((await plans.list()).active).toBe(b.id);
    await plans.setActive(null);
    expect((await plans.list()).active).toBeNull();
    await expect(plans.setActive('nope')).rejects.toMatchObject({
      status: 404,
    });
    await expect(plans.setActive('../x')).rejects.toMatchObject({
      status: 404,
    });
    expect(notify).toHaveBeenCalled();
  });

  it('keeps masterContext when the active plan changes', async () => {
    await mkdir(root, { recursive: true });
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        join(root, '.plugin-master/config.json'),
        JSON.stringify({ masterContext: ['IDEA.md'] }),
      ),
    );
    const a = await plans.create({ title: 'A', goal: '' });
    expect(
      JSON.parse(
        await readFile(join(root, '.plugin-master/config.json'), 'utf8'),
      ),
    ).toEqual({
      masterContext: ['IDEA.md'],
      activePlan: a.id,
      evalTrusted: false,
      evalBaselines: {},
      evalRefs: {},

      features: FeaturesSchema.parse({}),
    });
  });

  it('sets phases (keeping started ones) and tracks phase progress with log entries', async () => {
    await plans.create({ title: 'A', goal: '' });
    await plans.setPhases(['one', 'two', 'three']);
    await plans.startPhase('p1');
    await plans.completePhase('p1', 'did it');
    await plans.startPhase('p2');
    const p = await plans.setPhases(['x', 'y']);
    expect(p.phases.map((x) => [x.id, x.title, x.status])).toEqual([
      ['p1', 'one', 'done'],
      ['p2', 'two', 'in_progress'],
      ['p4', 'x', 'pending'],
      ['p5', 'y', 'pending'],
    ]);
    await plans.addLog('note');
    const { plan } = await current();
    expect(plan.log.map((l) => l.message)).toEqual([
      'Created',
      'Phases set (3 total)',
      'Started phase: one',
      'Completed phase: one. did it',
      'Started phase: two',
      'Phases set (4 total)',
      'note',
    ]);
    expect(plan.log.at(-1)?.phaseId).toBe('p2');
    await expect(plans.startPhase('p99')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('runs a child plan and returns to the parent when it completes', async () => {
    const parent = await plans.create({ title: 'Parent', goal: '' });
    await plans.setPhases(['big', 'after']);
    const child = await plans.startChild('p1', { title: 'Child', goal: 'cg' }, [
      'c1',
      'c2',
    ]);
    const cur = await current();
    expect(cur.plan.id).toBe(child.id);
    expect(cur.ancestors.map((a) => a.id)).toEqual([parent.id]);
    expect(child).toMatchObject({ parentId: parent.id, parentPhaseId: 'p1' });
    const mid = (await plans.list()).plans.find((p) => p.id === parent.id)!;
    expect(mid.phases[0]).toMatchObject({
      status: 'in_progress',
      childPlanId: child.id,
    });

    const done = await plans.complete('child done');
    expect(done.parent?.id).toBe(parent.id);
    const after = (await plans.list()).plans;
    expect(after.find((p) => p.id === child.id)?.status).toBe('done');
    expect(after.find((p) => p.id === parent.id)?.phases[0].status).toBe(
      'done',
    );
    expect((await plans.list()).active).toBe(parent.id);

    await plans.complete('all done');
    expect((await plans.list()).active).toBeNull();
    await expect(plans.startPhase('p2')).rejects.toMatchObject({
      code: 'PLAN_INVALID',
    });
  });

  it('rejects a child for a finished phase', async () => {
    await plans.create({ title: 'A', goal: '' });
    await plans.setPhases(['one']);
    await plans.completePhase('p1', 's');
    await expect(
      plans.startChild('p1', { title: 'C', goal: '' }, []),
    ).rejects.toMatchObject({ code: 'PLAN_INVALID' });
  });

  it('serializes parallel mutations', async () => {
    await plans.create({ title: 'A', goal: '' });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => plans.addLog(`n${i}`)),
    );
    expect((await current()).plan.log).toHaveLength(11);
  });
});
