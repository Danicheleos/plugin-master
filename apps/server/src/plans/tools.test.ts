import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlansService } from './service';
import { PLAN_TOOL_NAMES, planTools, runTool } from './tools';

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

  it('plan_create creates a top-level plan and makes it active', async () => {
    const plans = createPlansService(root);
    const t = planTools(plans);
    await plans.create({ title: 'Old', goal: 'g' });
    await plans.complete('done');
    expect(await t.plan_create.run({ title: 'New', goal: 'ng' })).toMatch(
      /Plan "New" \([0-9a-f]{8}\) is now active/,
    );
    const cur = await plans.current();
    expect(cur?.plan).toMatchObject({ title: 'New', goal: 'ng', parentId: null });
  });

  it('plan_create leaves the active plan active and creates the new one inactive', async () => {
    const plans = createPlansService(root);
    const t = planTools(plans);
    const { plan: top } = await plans.create({ title: 'Top', goal: 'g' });
    const out = await t.plan_create.run({ title: 'Backlog', goal: 'ng' });
    expect(out).toMatch(/Plan "Backlog" \([0-9a-f]{8}\) created, not active/);
    const list = await plans.list();
    expect(list.plans).toHaveLength(2);
    expect(list.active).toBe(top.id);
  });

  it('auto-allows the plan tools except plan_create, which needs the user prompt', () => {
    expect(PLAN_TOOL_NAMES).not.toContain('mcp__plan__plan_create');
    expect(PLAN_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'mcp__plan__plan_get',
        'mcp__plan__plan_start_child',
        'mcp__plan__plan_complete',
      ]),
    );
  });
});
