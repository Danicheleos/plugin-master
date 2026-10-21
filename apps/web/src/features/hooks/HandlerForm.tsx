import { ActionIcon, Checkbox, Group, NumberInput, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { DEFAULT_TIMEOUTS, HANDLER_TYPES, TOOL_EVENTS, type Handler, type HandlerType, type HookProblem, type HookSource } from '@pm/protocol';
import { TYPE_FIELDS, setField, setType } from './draft';

type Props = {
  handler: Handler;
  index: number;
  event: string;
  source: HookSource;
  problems: HookProblem[];
  onChange: (h: Handler) => void;
  onRemove: () => void;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Form of one handler; unknown keys of `handler` stay untouched. */
export function HandlerForm({ handler, index, event, source, problems, onChange, onRemove }: Props) {
  const err = (field: string) => problems.find((p) => p.path === `hooks[${index}].${field}`)?.message;
  const text = (field: string, label: string) => {
    const Input = field === 'prompt' ? Textarea : TextInput;
    return (
      <Input
        key={field}
        label={label}
        size="xs"
        value={str(handler[field])}
        error={err(field)}
        onChange={(e) => onChange(setField(handler, field, e.currentTarget.value))}
      />
    );
  };
  return (
    <Stack gap={4} p="xs" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-sm)' }}>
      <Group align="flex-end" wrap="nowrap">
        <Select
          label="Type"
          size="xs"
          data={[...HANDLER_TYPES]}
          allowDeselect={false}
          value={handler.type}
          error={err('type')}
          onChange={(t) => t && onChange(setType(handler, t))}
        />
        <NumberInput
          label="Timeout (s)"
          size="xs"
          min={1}
          placeholder={String(DEFAULT_TIMEOUTS[handler.type as HandlerType] ?? '')}
          value={handler.timeout ?? ''}
          error={err('timeout')}
          onChange={(v) => onChange(setField(handler, 'timeout', v === '' ? undefined : Number(v)))}
        />
        <ActionIcon variant="subtle" color="red" aria-label="Remove handler" onClick={onRemove}>
          ✕
        </ActionIcon>
      </Group>
      {(TYPE_FIELDS[handler.type] ?? []).map((f) => text(f, f))}
      {TOOL_EVENTS.includes(event) && text('if', 'if (permission rule, e.g. Bash(git *))')}
      {source === 'skill' && (
        <Checkbox
          size="xs"
          label="once"
          checked={handler.once === true}
          error={err('once')}
          onChange={(e) => onChange(setField(handler, 'once', e.currentTarget.checked || undefined))}
        />
      )}
    </Stack>
  );
}
