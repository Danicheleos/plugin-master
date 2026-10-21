import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PlanSchema,
  PlansResponseSchema,
  type CreatePlan,
  type Plan,
} from '@pm/protocol';
import { request } from '../../api/http';
import { useSpaceEvents } from '../../api/ws';

export const plansKey = (spaceId: string) => ['plans', spaceId];

/** Plans of the space; refetched on the server's `plans.changed`. */
export function usePlans(spaceId: string) {
  const qc = useQueryClient();
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'plans.changed')
      void qc.invalidateQueries({ queryKey: plansKey(spaceId) });
  });
  return useQuery({
    queryKey: plansKey(spaceId),
    queryFn: () =>
      request(
        'GET',
        `/api/spaces/${spaceId}/plans`,
        undefined,
        PlansResponseSchema,
      ),
  });
}

export function useCreatePlan(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreatePlan) =>
      request('POST', `/api/spaces/${spaceId}/plans`, v, PlanSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: plansKey(spaceId) }),
  });
}

export function useSetActivePlan(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | null) =>
      request(
        'PUT',
        `/api/spaces/${spaceId}/plans/active`,
        { id },
        PlansResponseSchema,
      ),
    onSuccess: (data) => qc.setQueryData(plansKey(spaceId), data),
  });
}

/** "Parent › Child" for a plan, following parentId links. */
export function planPath(plan: Plan, plans: Plan[]): string {
  const titles = [plan.title];
  for (let p = plan, n = 0; p.parentId && n < 20; n++) {
    const parent = plans.find((x) => x.id === p.parentId);
    if (!parent) break;
    titles.unshift(parent.title);
    p = parent;
  }
  return titles.join(' › ');
}
