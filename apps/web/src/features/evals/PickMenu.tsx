import { Button, Checkbox, Group, Popover, Stack } from '@mantine/core';

/** Toolbar button with a checklist (columns of a table, charts of a set) and Reset. */
export function PickMenu({
  label,
  items,
  selected,
  onChange,
  onReset,
}: {
  label: string;
  items: { id: string; title: string }[];
  selected: ReadonlySet<string>;
  onChange: (ids: string[]) => void;
  onReset: () => void;
}) {
  return (
    <Group justify="flex-end" mb={4}>
      <Popover position="bottom-end" withArrow shadow="md">
        <Popover.Target>
          <Button size="compact-xs" variant="subtle" color="gray">
            {label}
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap={4}>
            {items.map((it) => (
              <Checkbox
                key={it.id}
                size="xs"
                label={it.title}
                checked={selected.has(it.id)}
                onChange={(e) =>
                  onChange(items.map((x) => x.id).filter((id) => (id === it.id ? e.currentTarget.checked : selected.has(id))))
                }
              />
            ))}
            <Button size="compact-xs" variant="default" onClick={onReset}>
              Reset
            </Button>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}
