import { ActionIcon, Group, NavLink, Text, Tooltip } from '@mantine/core';
import type { FileNode } from '@pm/protocol';
import { ContextToggle } from '../context/ContextToggle';
import { useTree } from './hooks';
import styles from './files.module.scss';

type Props = {
  spaceId: string;
  selected: string | null;
  onSelect: (path: string) => void;
  onNew: () => void;
};

export function FileTree({ spaceId, selected, onSelect, onNew }: Props) {
  const { data, error } = useTree(spaceId);
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
      {error && (
        <Text c="red" size="sm">
          {error.message}
        </Text>
      )}
      <Nodes
        spaceId={spaceId}
        nodes={data ?? []}
        selected={selected}
        onSelect={onSelect}
      />
    </nav>
  );
}

type NodesProps = Pick<Props, 'spaceId' | 'selected' | 'onSelect'> & {
  nodes: FileNode[];
};

function Nodes({ spaceId, nodes, selected, onSelect }: NodesProps) {
  return nodes.map((n) =>
    n.type === 'dir' ? (
      <NavLink
        component="button"
        key={n.path}
        label={n.name}
        py={2}
        childrenOffset={12}
      >
        <Nodes
          spaceId={spaceId}
          nodes={n.children ?? []}
          selected={selected}
          onSelect={onSelect}
        />
      </NavLink>
    ) : (
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
    ),
  );
}
