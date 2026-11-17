import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  PlanSchema,
  PlansResponseSchema,
  type CreatePlan,
  type Plan,
} from '@pm/protocol';
import { request } from '../../api/http';
import { spaceUrl, useSpaceInvalidate } from '../../api/space';

export const plansKey = (spaceId: string) => ['plans', spaceId];

export const planQueries = {
  list: (spaceId: string) =>
    queryOptions({
      queryKey: plansKey(spaceId),
      queryFn: () =>
        request(
          'GET',
          spaceUrl(spaceId, 'plans'),
          undefined,
          PlansResponseSchema,
        ),
    }),
};

/** Plans of the space. NOTE: also subscribes to the server's `plans.changed` (refetch). */
export function usePlans(spaceId: string) {
  useSpaceInvalidate(spaceId, (m) => m.type === 'plans.changed', [
    plansKey(spaceId),
  ]);
  return useQuery(planQueries.list(spaceId));
}

export function useCreatePlan(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreatePlan) =>
      request('POST', spaceUrl(spaceId, 'plans'), v, PlanSchema),
    onSettled: () => qc.invalidateQueries({ queryKey: plansKey(spaceId) }),
  });
}

/** The answer is the full fresh listing, so it is written to the cache as is. */
export function useSetActivePlan(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | null) =>
      request(
        'PUT',
        spaceUrl(spaceId, 'plans', 'active'),
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
