import { ActionIcon, Text, Tooltip } from '@mantine/core';
import { useSpaceConfig, useToggleContext } from './hooks';
import styles from './context.module.scss';

/** 📌 next to a file: filled when the file is in the master context; click toggles it. */
export function ContextToggle({
  spaceId,
  path,
}: {
  spaceId: string;
  path: string;
}) {
  const { data, error } = useSpaceConfig(spaceId);
  const toggle = useToggleContext(spaceId);
  if (error)
    return (
      <Tooltip label={error.message}>
        <Text span className={styles.unpinned}>
          ⚠
        </Text>
      </Tooltip>
    );
  if (!data) return null;
  const pinned = data.masterContext.includes(path);
  return (
    <Tooltip
      label={pinned ? 'Remove from master context' : 'Add to master context'}
    >
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label={pinned ? 'Unpin from context' : 'Pin to context'}
        className={pinned ? undefined : styles.unpinned}
        onClick={() => toggle(path)}
      >
        <span aria-hidden>📌</span>
      </ActionIcon>
    </Tooltip>
  );
}
