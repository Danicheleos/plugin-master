import { ActionIcon, Group, NavLink, Text, Tooltip } from '@mantine/core';
import { ContextToggle } from '../context/ContextToggle';
import { useDir } from './hooks';
import styles from './files.module.scss';

type Props = {
  spaceId: string;
  selected: string | null;
  onSelect: (path: string) => void;
  /** expanded directories; their listings are loaded and watched */
  expanded: ReadonlySet<string>;
  onToggle: (dir: string) => void;
  onNew: () => void;
};

export function FileTree({ onNew, ...rest }: Props) {
  return (
    <nav className={styles.tree}>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Files</Text>
        <Tooltip label="New file">
          <ActionIcon
            variant="default"
            size="sm"
            aria-label="New file"
            onClick={onNew}
          >
            +
          </ActionIcon>
        </Tooltip>
      </Group>
      <Nodes dir="" {...rest} />
    </nav>
  );
}

type NodesProps = Omit<Props, 'onNew'> & { dir: string };

function Nodes({ dir, ...props }: NodesProps) {
  const { spaceId, selected, onSelect, expanded, onToggle } = props;
  const { data, error } = useDir(spaceId, dir);
  if (error)
    return (
      <Text c="red" size="sm">
        {error.message}
      </Text>
    );
  return (data ?? []).map((n) => {
    if (n.type === 'file')
      return (
        <Group key={n.path} gap={0} wrap="nowrap">
          <NavLink
            component="button"
            flex={1}
            py={2}
            label={n.name}
            active={n.path === selected}
            onClick={() => onSelect(n.path)}
          />
          <ContextToggle spaceId={spaceId} path={n.path} />
        </Group>
      );
    const open = expanded.has(n.path);
    return (
      <NavLink
        component="button"
        key={n.path}
        label={n.name}
        leftSection={open ? '▾' : '▸'}
        py={2}
        childrenOffset={12}
        opened={open}
        onClick={() => onToggle(n.path)}
      >
        {open && <Nodes dir={n.path} {...props} />}
      </NavLink>
    );
  });
}
