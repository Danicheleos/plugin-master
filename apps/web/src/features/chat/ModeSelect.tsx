import { Select, Text } from '@mantine/core';
import type { ChatMode } from '@pm/protocol';

export const MODE_LABELS: Record<ChatMode, string> = {
  default: 'Manual',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  dontAsk: 'Don’t ask',
};

const MODE_DESCRIPTIONS: Record<ChatMode, string> = {
  default: 'Ask before every action',
  acceptEdits: 'File edits are allowed, the rest asks',
  plan: 'Read-only; proposes a plan, approving it leaves plan mode',
  auto: 'A classifier decides, asks when unsure',
  dontAsk: 'Only pre-allowed tools; the rest is denied',
};

const MODE_ORDER: ChatMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
];
const MODE_DATA = MODE_ORDER.map((value) => ({
  value,
  label: MODE_LABELS[value],
}));

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
      data={MODE_DATA}
      value={mode}
      onChange={(m) => m && onChange(m as ChatMode)}
      renderOption={({ option }) => (
        <div>
          <Text size="sm">{option.label}</Text>
          <Text size="xs" c="dimmed">
            {MODE_DESCRIPTIONS[option.value as ChatMode]}
          </Text>
        </div>
      )}
      comboboxProps={{ width: 260, position: 'bottom-end' }}
    />
  );
}
