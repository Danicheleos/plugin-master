import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import type { PlansService } from './service';

export const PLAN_SERVER = 'plan';

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Result => ({
  content: [{ type: 'text', text: t }],
  ...(isError && { isError }),
});

const titles = z.array(z.string().min(1));
const phaseId = z.string().describe('Phase id, e.g. "p1"');

/** A tool definition; `run` is plain so tests can call it without the SDK. */
export const def = <S extends z.ZodRawShape>(
  description: string,
  shape: S,
  run: (a: z.infer<z.ZodObject<S>>) => Promise<string>,
) => ({ description, shape, run });

export function planTools(plans: PlansService) {
  return {
    plan_get: def(
      'Get the active plan (goal, phases, recent log) and its ancestor plans.',
      {},
      async () => {
        const cur = await plans.current();
        if (!cur)
          return 'There is no active plan. Ask the user to create or select one, or work without a plan.';
        const { plan, ancestors } = cur;
        return JSON.stringify(
          {
            plan: { ...plan, log: plan.log.slice(-5) },
            ancestors: ancestors.map((a) => ({
              title: a.title,
              currentPhase: a.phases.find((p) => p.status === 'in_progress')
                ?.title,
            })),
          },
          null,
          2,
        );
      },
    ),
    plan_set_phases: def(
      'Set the phases of the active plan: finished and started phases are kept, pending ones are replaced by this list (in order).',
      { phases: titles },
      async ({ phases }) => {
        const p = await plans.setPhases(phases);
        return p.phases
          .map((x) => `${x.id} [${x.status}] ${x.title}`)
          .join('\n');
      },
    ),
    phase_start: def(
      'Mark a phase of the active plan as in progress.',
      { phaseId },
      async (a) => {
        await plans.startPhase(a.phaseId);
        return 'Phase started.';
      },
    ),
    phase_complete: def(
      'Mark a phase of the active plan as done.',
      { phaseId, summary: z.string().describe('What was done') },
      async (a) => {
        await plans.completePhase(a.phaseId, a.summary);
        return 'Phase completed.';
      },
    ),
    plan_log: def(
      'Add a progress note to the active plan log.',
      { message: z.string() },
      async (a) => {
        await plans.addLog(a.message);
        return 'Logged.';
      },
    ),
    plan_start_child: def(
      'Create a child plan for a phase that needs its own plan; the child becomes active.',
      { phaseId, title: z.string().min(1), goal: z.string(), phases: titles },
      async (a) => {
        const child = await plans.startChild(
          a.phaseId,
          { title: a.title, goal: a.goal },
          a.phases,
        );
        return `Child plan "${child.title}" is now active. Phases:\n${child.phases.map((x) => `${x.id} ${x.title}`).join('\n')}`;
      },
    ),
    plan_complete: def(
      'Mark the active plan done. A child plan hands control back to its parent plan.',
      { summary: z.string() },
      async (a) => {
        const { plan, parent } = await plans.complete(a.summary);
        if (!parent)
          return `Plan "${plan.title}" is complete. No plan is active now.`;
        const next = parent.phases.find(
          (p) => p.status !== 'done' && p.status !== 'skipped',
        );
        return `Plan "${plan.title}" is complete. The parent plan "${parent.title}" is active again. ${
          next
            ? `Continue with its next phase: ${next.id} ${next.title}.`
            : 'All its phases are done: call plan_complete for it.'
        }`;
      },
    ),
  };
}

export type PlanTools = ReturnType<typeof planTools>;

/** Runs a handler, turning plan errors into tool errors the model can read. */
export async function runTool(run: () => Promise<string>): Promise<Result> {
  try {
    return text(await run());
  } catch (e) {
    if (e instanceof AppError) return text(e.message, true);
    throw e;
  }
}

export const PLAN_TOOL_NAMES = (
  Object.keys(planTools({} as PlansService)) as (keyof PlanTools)[]
).map((n) => `mcp__${PLAN_SERVER}__${n}`);

/** In-process MCP server over `def` tools. */
export const createToolServer = (
  name: string,
  tools: Record<string, { description: string; shape: z.ZodRawShape; run: (a: never) => Promise<string> }>,
) =>
  createSdkMcpServer({
    name,
    tools: Object.entries(tools).map(([n, t]) =>
      // the handler argument type is erased here: each tool's shape validates its own input
      tool(n, t.description, t.shape, (a) => runTool(() => t.run(a as never))),
    ),
  });

/** In-process MCP server with the plan tools of one space. */
export const createPlanMcpServer = (plans: PlansService) =>
  createToolServer(PLAN_SERVER, planTools(plans));
