import { Button, Menu, Text } from '@mantine/core';
import type { Features } from '@pm/protocol';
import { useFeatures, useSetFeatures } from './hooks';

const ITEMS: {
  key: keyof Features;
  label: string;
  hint: string;
}[] = [
  { key: 'git', label: 'Git', hint: 'Status, diff, commits and branches' },
  {
    key: 'autoCommit',
    label: 'Auto-commit',
    hint: 'Commit after agent changes (needs Git)',
  },
  {
    key: 'masterLoop',
    label: 'Master loop',
    hint: 'Experiments in separate git worktrees (needs Git)',
  },
  {
    key: 'userSettings',
    label: 'Use my Claude settings',
    hint: 'Load your ~/.claude settings, plugins, skills and MCP servers into the agent. Installed copies of the plugin you are developing may interfere. Applies to new sessions.',
  },
];

export function FeaturesMenu({ spaceId }: { spaceId: string }) {
  const { data } = useFeatures(spaceId);
  const set = useSetFeatures(spaceId);
  return (
    <Menu position="bottom-end" closeOnItemClick={false}>
      <Menu.Target>
        <Button variant="default" size="compact-sm">
          Features
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {ITEMS.map(({ key, label, hint }) => {
          const on = data?.[key] ?? false;
          return (
            <Menu.Item
              key={key}
              role="menuitemcheckbox"
              aria-checked={on}
              disabled={!data || (key !== 'git' && key !== 'userSettings' && !data.git)}
              leftSection={on ? '☑' : '☐'}
              // turning git off also turns its dependents off
              onClick={() =>
                set.mutate({
                  [key]: !on,
                  ...(key === 'git' && on ? { autoCommit: false, masterLoop: false } : {}),
                })
              }
            >
              <Text size="sm">{label}</Text>
              <Text size="xs" c="dimmed">
                {hint}
              </Text>
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}
