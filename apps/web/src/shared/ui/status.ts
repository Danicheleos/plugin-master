import type { EvalCaseState, EvalState, GateStatus } from '@pm/protocol';

/** Mantine badge colors of the statuses shown across the widgets (one table, so they stay consistent). */
export const EVAL_STATE_COLOR: Record<EvalState, string> = {
  idle: 'gray',
  running: 'blue',
  done: 'green',
  failed: 'red',
  cancelled: 'yellow',
};

export const GATE_STATUS_COLOR: Record<GateStatus, string> = {
  pass: 'green',
  fail: 'red',
  unknown: 'gray',
};

const EXPERIMENT_STATUS_COLOR: Record<string, string> = {
  running: 'blue',
  ready: 'green',
  merged: 'teal',
  failed: 'red',
};
export const experimentStatusColor = (status: string) =>
  EXPERIMENT_STATUS_COLOR[status] ?? 'gray';

/** Color of a trace row by tool kind (see `toolKind`). */
export const TOOL_KIND_COLOR = {
  skill: 'grape',
  read: 'blue',
  edit: 'orange',
  bash: 'teal',
  agent: 'violet',
  other: 'gray',
} as const;

export const CASE_STATE_ICON: Record<
  EvalCaseState,
  { mark: string; color: string }
> = {
  queued: { mark: '○', color: 'dimmed' },
  running: { mark: '▶', color: 'blue' },
  done: { mark: '✓', color: 'green' },
  failed: { mark: '✗', color: 'red' },
  cancelled: { mark: '–', color: 'yellow' },
};
