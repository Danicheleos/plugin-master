import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlansService } from './service';
import { planTools, runTool } from './tools';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pm-plantools-'));
  await mkdir(join(root, '.plugin-master'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('plan tools', () => {
  it('walks a plan with a child plan through the tool handlers', async () => {
    const plans = createPlansService(root);
    const t = planTools(plans);
    expect(await t.plan_get.run({})).toMatch(/no active plan/);
    await plans.create({ title: 'Top', goal: 'g' });
    expect(await t.plan_set_phases.run({ phases: ['a', 'b'] })).toBe(
      'p1 [pending] a\np2 [pending] b',
    );
    await t.phase_start.run({ phaseId: 'p1' });
    expect(
      await t.plan_start_child.run({
        phaseId: 'p1',
        title: 'Sub',
        goal: 'sg',
        phases: ['x'],
      }),
    ).toMatch(/Child plan "Sub" is now active/);
    const got = JSON.parse(await t.plan_get.run({}));
    expect(got.plan.title).toBe('Sub');
    expect(got.ancestors).toEqual([{ title: 'Top', currentPhase: 'a' }]);
    await t.phase_complete.run({ phaseId: 'p1', summary: 's' });
    await t.plan_log.run({ message: 'm' });
    const text = await t.plan_complete.run({ summary: 'sub done' });
    expect(text).toMatch(/"Top" is active again.*p2 b/);
    expect(await t.plan_complete.run({ summary: 'x' })).toMatch(
      /Continue|complete/,
    );
  });

  it('turns plan errors into tool errors', async () => {
    const t = planTools(createPlansService(root));
    const r = await runTool(() => t.phase_start.run({ phaseId: 'p1' }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/no active plan/);
  });
});
