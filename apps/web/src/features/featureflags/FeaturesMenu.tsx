import { Button, Menu, Text } from '@mantine/core';
import {
  FEATURE_REQUIRES,
  featureDependents,
  type Features,
} from '@pm/protocol';
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
        {set.error && (
          <Text size="xs" c="red" px="sm" py={4} role="alert">
            Could not save: {set.error.message}
          </Text>
        )}
        {ITEMS.map(({ key, label, hint }) => {
          const on = data?.[key] ?? false;
          const required = FEATURE_REQUIRES[key];
          return (
            <Menu.Item
              key={key}
              role="menuitemcheckbox"
              aria-checked={on}
              disabled={!data || (!!required && !data[required])}
              leftSection={on ? '☑' : '☐'}
              // turning a feature off also turns its dependents off
              onClick={() =>
                set.mutate({
                  [key]: !on,
                  ...(on
                    ? Object.fromEntries(
                        featureDependents(key).map((f) => [f, false]),
                      )
                    : {}),
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
