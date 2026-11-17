import type { ReactNode } from 'react';
import { Anchor, Group, type AnchorProps } from '@mantine/core';
import { useOpen } from './prefs';
import styles from './evals.module.scss';

/**
 * A suite/target block: a header row (toggle anchor, then `header`) and `children` below it while
 * open. The expanded state is persisted in the evals prefs under `openKey`.
 */
export function CollapsibleSection({
  openKey,
  defaultOpen = false,
  anchor,
  anchorProps,
  header,
  children,
}: {
  openKey: string;
  defaultOpen?: boolean;
  /** content of the toggle anchor */
  anchor: (open: boolean) => ReactNode;
  anchorProps?: AnchorProps & { 'aria-label'?: string };
  header: ReactNode;
  children: ReactNode;
}) {
  const [open, toggle] = useOpen(openKey, defaultOpen);
  return (
    <section className={styles.suite}>
      <Group gap="xs" mb="xs">
        <Anchor
          component="button"
          {...anchorProps}
          aria-expanded={open}
          onClick={toggle}
        >
          {anchor(open)}
        </Anchor>
        {header}
      </Group>
      {open && children}
    </section>
  );
}
