import { useRef, type RefObject } from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import type { Item } from './layout';
import styles from './dashboard.module.scss';

function HeaderButton({
  tip,
  label,
  icon,
  onClick,
  pressed,
  disabled,
}: {
  tip: string;
  label: string;
  icon: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={tip}>
      <ActionIcon
        variant={pressed ? 'light' : 'subtle'}
        size="sm"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

/** A widget's header: the title (drag handle; a tap collapses a focused widget) and maximize / duplicate / remove. */
export function WidgetHeader({
  item,
  title,
  wasFocused,
  onMaximize,
  onDuplicate,
  onRemove,
  onToggleCollapse,
}: {
  item: Item;
  title: string;
  /** whether the widget was already focused when the current pointer-down started */
  wasFocused: RefObject<boolean>;
  onMaximize: (i: string) => void;
  onDuplicate: (i: string) => void;
  onRemove: (i: string) => void;
  onToggleCollapse: (i: string) => void;
}) {
  // pointer events, not click: on touch the drag handle swallows the synthesized click; a drag is not a tap
  const down = useRef<[number, number] | null>(null);
  const collapsed = item.prevH !== undefined;
  return (
    <Group
      className={styles.header}
      gap={4}
      wrap="nowrap"
      data-collapsed={collapsed || undefined}
      onPointerDown={(e) => (down.current = [e.clientX, e.clientY])}
      onPointerUp={(e) => {
        const start = down.current;
        down.current = null;
        if (!start || (e.target as HTMLElement).closest('button')) return;
        if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) return;
        if (collapsed || wasFocused.current) onToggleCollapse(item.i);
      }}
    >
      <Text className={styles.title} fw={600} size="sm" flex={1}>
        {title}
      </Text>
      <HeaderButton
        tip="Maximize"
        label={`Maximize ${title}`}
        icon="⤢"
        onClick={() => onMaximize(item.i)}
      />
      <HeaderButton
        tip="Duplicate"
        label={`Duplicate ${title}`}
        icon="⧉"
        onClick={() => onDuplicate(item.i)}
      />
      <HeaderButton
        tip="Remove"
        label={`Remove ${title}`}
        icon="✕"
        onClick={() => onRemove(item.i)}
      />
    </Group>
  );
}
