import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import {
  PlanSchema,
  type CreatePlan,
  type Phase,
  type Plan,
  type PlansResponse,
} from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import { readConfig, withLock, writeConfig } from '../spaces/config-file';

const PLANS_DIR = '.plugin-master/plans';
const ID = /^[A-Za-z0-9-]+$/;

const notFound = (what: string) =>
  new AppError('PLAN_NOT_FOUND', `${what} not found`, 404);
const bad = (message: string) => new AppError('PLAN_INVALID', message, 409);

const phasesOf = (titles: string[], from: number): Phase[] =>
  titles.map((title, i) => ({
    id: `p${from + i}`,
    title,
    status: 'pending',
  }));

/**
 * Plans of one space root, stored as `.plugin-master/plans/<id>.json`; the active plan id lives
 * in config.json. Every mutation logs itself and calls `notify` (used for the `plans.changed` broadcast).
 */
export function createPlansService(root: string, notify?: () => void) {
  const file = (id: string) => {
    if (!ID.test(id)) throw notFound(`Plan "${id}"`);
    return resolveInSpace(root, `${PLANS_DIR}/${id}.json`);
  };
  const save = (p: Plan) =>
    writeFile(file(p.id), JSON.stringify(p, null, 2) + '\n');
  const log = (p: Plan, message: string, phaseId?: string) =>
    p.log.push({
      at: new Date().toISOString(),
      message,
      ...(phaseId && { phaseId }),
    });

  async function load(id: string): Promise<Plan> {
    try {
      return PlanSchema.parse(JSON.parse(await readFile(file(id), 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw notFound(`Plan "${id}"`);
      throw e;
    }
  }
  async function setActiveId(id: string | null) {
    await writeConfig(root, { ...(await readConfig(root)), activePlan: id });
  }
  async function activePlan(): Promise<Plan> {
    const { activePlan: id } = await readConfig(root);
    if (!id) throw bad('There is no active plan');
    return load(id);
  }
  const phaseOf = (p: Plan, id: string) => {
    const phase = p.phases.find((x) => x.id === id);
    if (!phase) throw notFound(`Phase "${id}" in plan "${p.title}"`);
    return phase;
  };
  /** Serialized read-modify-write; broadcasts afterwards. */
  async function mutate<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(resolveInSpace(root, PLANS_DIR), { recursive: true });
    const result = await withLock(root, fn);
    notify?.();
    return result;
  }
  async function create(input: CreatePlan, parent?: Plan, phaseId?: string) {
    const plan: Plan = {
      id: randomUUID().slice(0, 8),
      title: input.title,
      goal: input.goal,
      parentId: parent?.id ?? null,
      parentPhaseId: phaseId ?? null,
      status: 'active',
      createdAt: new Date().toISOString(),
      phases: [],
      log: [],
    };
    log(plan, parent ? `Created as a child of "${parent.title}"` : 'Created');
    return plan;
  }

  return {
    async list(): Promise<PlansResponse> {
      const names = await readdir(resolveInSpace(root, PLANS_DIR)).catch(
        () => [] as string[],
      );
      const plans = (
        await Promise.all(
          names
            .filter((n) => n.endsWith('.json'))
            .map((n) => load(n.slice(0, -5)).catch(() => undefined)),
        )
      ).filter((p): p is Plan => !!p);
      plans.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { active: (await readConfig(root)).activePlan, plans };
    },

    /** The active plan and its ancestors (nearest first); null when none is active. */
    async current(): Promise<{ plan: Plan; ancestors: Plan[] } | null> {
      if (!(await readConfig(root)).activePlan) return null;
      const plan = await activePlan();
      const ancestors: Plan[] = [];
      for (let p = plan; p.parentId && ancestors.length < 20;) {
        p = await load(p.parentId).catch(() => p);
        if (p === ancestors.at(-1) || p.id === plan.id) break;
        ancestors.push(p);
      }
      return { plan, ancestors };
    },

    /** Creates a top-level plan; it becomes active when none is. */
    create: (input: CreatePlan) =>
      mutate(async () => {
        const plan = await create(input);
        const config = await readConfig(root);
        await save(plan);
        if (!config.activePlan) await setActiveId(plan.id);
        return plan;
      }),

    setActive: (id: string | null) =>
      mutate(async () => {
        if (id === null) return setActiveId(null);
        const plan = await load(id);
        log(plan, 'Made the active plan');
        await save(plan);
        await setActiveId(id);
      }),

    /** Replaces the pending phases of the active plan; started, done and skipped ones stay first. */
    setPhases: (titles: string[]) =>
      mutate(async () => {
        const plan = await activePlan();
        const kept = plan.phases.filter((p) => p.status !== 'pending');
        const next =
          Math.max(0, ...plan.phases.map((p) => Number(p.id.slice(1)))) + 1;
        plan.phases = [...kept, ...phasesOf(titles, next)];
        log(plan, `Phases set (${plan.phases.length} total)`);
        await save(plan);
        return plan;
      }),

    startPhase: (phaseId: string) =>
      mutate(async () => {
        const plan = await activePlan();
        const phase = phaseOf(plan, phaseId);
        phase.status = 'in_progress';
        log(plan, `Started phase: ${phase.title}`, phaseId);
        await save(plan);
        return plan;
      }),

    completePhase: (phaseId: string, summary: string) =>
      mutate(async () => {
        const plan = await activePlan();
        const phase = phaseOf(plan, phaseId);
        phase.status = 'done';
        log(plan, `Completed phase: ${phase.title}. ${summary}`, phaseId);
        await save(plan);
        return plan;
      }),

    addLog: (message: string) =>
      mutate(async () => {
        const plan = await activePlan();
        const current = plan.phases.find((p) => p.status === 'in_progress');
        log(plan, message, current?.id);
        await save(plan);
        return plan;
      }),

    /** Creates a child plan for a phase of the active plan and makes it active. */
    startChild: (phaseId: string, input: CreatePlan, phases: string[]) =>
      mutate(async () => {
        const parent = await activePlan();
        const phase = phaseOf(parent, phaseId);
        if (phase.status === 'done' || phase.status === 'skipped')
          throw bad(`Phase "${phase.title}" is already ${phase.status}`);
        const child = await create(input, parent, phaseId);
        child.phases = phasesOf(phases, 1);
        phase.status = 'in_progress';
        phase.childPlanId = child.id;
        log(parent, `Started child plan: ${child.title}`, phaseId);
        await save(child);
        await save(parent);
        await setActiveId(child.id);
        return child;
      }),

    /**
     * Marks the active plan done. With a parent, its phase is done too and the parent becomes
     * active (returned as `parent`); otherwise nothing stays active.
     */
    complete: (summary: string) =>
      mutate(async () => {
        const plan = await activePlan();
        plan.status = 'done';
        log(plan, `Plan completed. ${summary}`);
        await save(plan);
        const parent = plan.parentId
          ? await load(plan.parentId).catch(() => undefined)
          : undefined;
        if (parent) {
          const phase = parent.phases.find((p) => p.id === plan.parentPhaseId);
          if (phase) phase.status = 'done';
          log(
            parent,
            `Child plan "${plan.title}" completed. ${summary}`,
            phase?.id,
          );
          await save(parent);
        }
        await setActiveId(parent?.id ?? null);
        return { plan, parent };
      }),
  };
}

export type PlansService = ReturnType<typeof createPlansService>;
