import { memo } from 'react';
import { Select } from '@mantine/core';
import { CHAT_MODELS, type ChatModel } from '@pm/protocol';

const DATA = Object.entries(CHAT_MODELS).map(([value, label]) => ({
  value,
  label,
}));

/** Model of the agent; applies to the live session at once. Disabled until the server reported it. */
export const ModelSelect = memo(function ModelSelect({
  model,
  onChange,
}: {
  model: ChatModel | null;
  onChange: (model: ChatModel) => void;
}) {
  return (
    <Select
      size="xs"
      w={110}
      aria-label="Model"
      allowDeselect={false}
      disabled={!model}
      placeholder="Model…"
      data={DATA}
      value={model}
      onChange={(m) => m && onChange(m as ChatModel)}
    />
  );
});
