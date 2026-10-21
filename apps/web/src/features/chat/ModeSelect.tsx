import { Select, Text } from '@mantine/core';
import type { ChatMode } from '@pm/protocol';

const MODES: { value: ChatMode; label: string; description: string }[] = [
  { value: 'default', label: 'Manual', description: 'Ask before every action' },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    description: 'File edits are allowed, the rest asks',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Read-only; proposes a plan, approving it leaves plan mode',
  },
  {
    value: 'auto',
    label: 'Auto',
    description: 'A classifier decides, asks when unsure',
  },
  {
    value: 'dontAsk',
    label: 'Don’t ask',
    description: 'Only pre-allowed tools; the rest is denied',
  },
];

/** Permission mode of the agent; applies to the live session at once. */
export function ModeSelect({
  mode,
  onChange,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
}) {
  return (
    <Select
      size="xs"
      w={130}
      aria-label="Mode"
      allowDeselect={false}
      data={MODES.map(({ value, label }) => ({ value, label }))}
      value={mode}
      onChange={(m) => m && onChange(m as ChatMode)}
      renderOption={({ option }) => (
        <div>
          <Text size="sm">{option.label}</Text>
          <Text size="xs" c="dimmed">
            {MODES.find((m) => m.value === option.value)?.description}
          </Text>
        </div>
      )}
      comboboxProps={{ width: 260, position: 'bottom-end' }}
    />
  );
}
