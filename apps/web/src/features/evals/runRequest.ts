import type { EvalRunRequest } from '@pm/protocol';

/** The fields of the run form (strings as typed; empty = not set). */
export type RunForm = {
  cost: string | number;
  cases?: string[];
  tags?: string[];
  runs?: string;
  model?: string;
  ablation?: boolean;
  allowTools?: string[];
  scaffold?: boolean;
};

/** The request of a run form: only the options that are set are included. */
export function buildRunRequest(f: RunForm): EvalRunRequest {
  return {
    maxCostUsd: Number(f.cost),
    ...(f.cases?.length && { cases: f.cases }),
    ...(f.tags?.length && { tags: f.tags }),
    ...(f.runs && { runs: Number(f.runs) }),
    ...(f.model && { model: f.model }),
    ...(f.ablation && { ablation: true }),
    ...(f.allowTools?.length && { allowTools: f.allowTools }),
    ...(f.scaffold && { scaffold: true }),
  };
}
