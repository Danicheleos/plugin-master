import { memo } from 'react';
import { Select } from '@mantine/core';
import type { ChatEffort } from '@pm/protocol';

const DATA: { value: ChatEffort; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

export const effortLabel = (e: ChatEffort) =>
  DATA.find((d) => d.value === e)?.label ?? e;

/** Reasoning effort of the agent; applies to the live session at once. */
export const EffortSelect = memo(function EffortSelect({
  effort,
  onChange,
}: {
  effort: ChatEffort;
  onChange: (effort: ChatEffort) => void;
}) {
  return (
    <Select
      size="xs"
      w={110}
      aria-label="Effort"
      allowDeselect={false}
      data={DATA}
      value={effort}
      onChange={(e) => e && onChange(e as ChatEffort)}
    />
  );
});
