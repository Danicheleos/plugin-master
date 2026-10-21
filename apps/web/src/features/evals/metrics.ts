import type { EvalCaseRun } from '@pm/protocol';
import { cost, num, score, seconds, tokens } from './format';

export type Metrics = NonNullable<EvalCaseRun['baselineMetrics']>;
/** Anything a chart can be drawn over: a case run, an invocation. */
export type MetricRun = Metrics & {
  runId: string;
  startedAt?: string;
  commit?: string;
  baselineMetrics?: Metrics;
};

/** Single source of truth for metric labels and formatters: chart set and table columns. */
export const METRICS: {
  id: keyof Metrics;
  label: string;
  /** table header */
  short: string;
  get: (r: Metrics) => number | undefined;
  format: (v?: number) => string;
  max?: number;
}[] = [
  { id: 'score', label: 'Score', short: 'Score', get: (r) => r.score, format: score, max: 1 },
  { id: 'passRate', label: 'Pass rate', short: 'Pass rate', get: (r) => r.passRate, format: score, max: 1 },
  { id: 'recall', label: 'Recall', short: 'R', get: (r) => r.recall, format: score, max: 1 },
  { id: 'precision', label: 'Precision', short: 'P', get: (r) => r.precision, format: score, max: 1 },
  { id: 'f1', label: 'F1', short: 'F1', get: (r) => r.f1, format: score, max: 1 },
  { id: 'costUsd', label: 'Cost', short: 'Cost', get: (r) => r.costUsd, format: cost },
  { id: 'turns', label: 'Turns', short: 'Turns', get: (r) => r.turns, format: num },
  { id: 'maxContext', label: 'Max context', short: 'Max context', get: (r) => r.maxContext, format: tokens },
  { id: 'tokens', label: 'Tokens', short: 'Tokens', get: (r) => r.tokens, format: tokens },
  { id: 'durationMs', label: 'Duration', short: 'Duration', get: (r) => r.durationMs, format: seconds },
];
