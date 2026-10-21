import { z } from 'zod';

export const PhaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'in_progress', 'done', 'skipped']),
  /** Set when the phase got its own, deeper plan. */
  childPlanId: z.string().optional(),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const LogEntrySchema = z.object({
  at: z.string(),
  phaseId: z.string().optional(),
  message: z.string(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const PlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  parentId: z.string().nullable(),
  parentPhaseId: z.string().nullable(),
  status: z.enum(['active', 'done']),
  createdAt: z.string(),
  phases: z.array(PhaseSchema),
  log: z.array(LogEntrySchema),
});
export type Plan = z.infer<typeof PlanSchema>;

export const CreatePlanSchema = z.object({
  title: z.string().trim().min(1),
  goal: z.string(),
});
export type CreatePlan = z.infer<typeof CreatePlanSchema>;

export const PlansResponseSchema = z.object({
  active: z.string().nullable(),
  plans: z.array(PlanSchema),
});
export type PlansResponse = z.infer<typeof PlansResponseSchema>;

export const SetActivePlanSchema = z.object({ id: z.string().nullable() });
