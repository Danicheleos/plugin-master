import { useState, type ReactNode } from 'react';
import { ActionIcon, Button, Card, Group, Text, Textarea } from '@mantine/core';
import { parseSkill, insertBlock, deleteBlock, type Block } from '@pm/protocol';
import { editOwn, lineCount, movable, ownText, sectionText, setFrontmatter, shift } from './ops';
import styles from './skills.module.scss';

type Apply = (fn: (text: string) => string) => void;

/** Inline text editor with Apply / Cancel. */
function TextBlock({ label, initial, onApply, onCancel }: { label: string; initial: string; onApply: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className={styles.edit}>
      <Textarea aria-label={label} autosize minRows={2} maxRows={16} value={v} onChange={(e) => setV(e.currentTarget.value)} />
      <Group gap="xs" mt={4}>
        <Button size="compact-xs" onClick={() => onApply(v)}>Apply</Button>
        <Button size="compact-xs" variant="default" onClick={onCancel}>Cancel</Button>
      </Group>
    </div>
  );
}

function Btn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <ActionIcon variant="subtle" size="sm" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </ActionIcon>
  );
}

type RowProps = { text: string; apply: Apply; onExtract: (id: string) => void };

function BlockRow({ text, block, apply, onExtract }: RowProps & { block: Block }) {
  const [mode, setMode] = useState<'edit' | 'delete' | null>(null);
  const sibs = movable(text, block.id);
  const at = sibs.findIndex((b) => b.id === block.id);
  const pre = block.kind === 'preamble';
  const label = pre ? 'Preamble' : block.title || '(untitled)';
  const done = () => setMode(null);
  return (
    <div>
      <Group gap={4} wrap="nowrap" className={styles.row} style={{ paddingLeft: `calc(${Math.max(block.level - 1, 0)} * var(--mantine-spacing-md))` }}>
        <Text size="sm" fw={pre ? 400 : 600} fs={pre ? 'italic' : undefined} flex={1} truncate>{label}</Text>
        <Text size="xs" c="dimmed">{lineCount(text, block)} lines</Text>
        <Btn label={`Edit ${label}`} onClick={() => setMode('edit')}>✎</Btn>
        <Btn label={`Move up ${label}`} disabled={pre || at <= 0} onClick={() => apply((t) => shift(t, block.id, -1))}>▲</Btn>
        <Btn label={`Move down ${label}`} disabled={pre || at < 0 || at >= sibs.length - 1} onClick={() => apply((t) => shift(t, block.id, 1))}>▼</Btn>
        <Btn label={`Duplicate ${label}`} onClick={() => apply((t) => insertBlock(t, block.id, 'after', sectionText(t, block.id)))}>⧉</Btn>
        <Btn label={`Move ${label} to sub-file`} disabled={pre} onClick={() => onExtract(block.id)}>⇥</Btn>
        <Btn label={`Delete ${label}`} onClick={() => setMode('delete')}>✕</Btn>
      </Group>
      {mode === 'delete' && (
        <Group gap="xs" className={styles.edit}>
          <Text size="sm">Delete "{label}" with its sub-blocks?</Text>
          <Button size="compact-xs" color="red" onClick={() => { apply((t) => deleteBlock(t, block.id)); done(); }}>Delete</Button>
          <Button size="compact-xs" variant="default" onClick={done}>Cancel</Button>
        </Group>
      )}
      {mode === 'edit' && (
        <TextBlock label={`Text of ${label}`} initial={ownText(text, block.id)} onCancel={done} onApply={(v) => { apply((t) => editOwn(t, block.id, v)); done(); }} />
      )}
    </div>
  );
}

function Frontmatter({ text, apply }: { text: string; apply: Apply }) {
  const [editing, setEditing] = useState(false);
  const fm = parseSkill(text).frontmatter;
  if (!fm) return <Text size="sm" c="dimmed" px="xs">No frontmatter</Text>;
  const data = fm.data && typeof fm.data === 'object' ? Object.entries(fm.data) : [];
  return (
    <Card withBorder padding="xs" m="xs">
      <Group justify="space-between">
        <Text size="sm" fw={600}>Frontmatter</Text>
        <Btn label="Edit frontmatter" onClick={() => setEditing(true)}>✎</Btn>
      </Group>
      {fm.error && <Text size="xs" c="red">{fm.error}</Text>}
      {data.map(([k, v]) => (
        <Text key={k} size="xs" truncate><b>{k}</b>: {typeof v === 'string' ? v : JSON.stringify(v)}</Text>
      ))}
      {editing && (
        <TextBlock label="Frontmatter YAML" initial={fm.raw} onCancel={() => setEditing(false)} onApply={(v) => { apply((t) => setFrontmatter(t, v)); setEditing(false); }} />
      )}
    </Card>
  );
}

const rows = (blocks: Block[], p: RowProps): ReactNode =>
  blocks.map((b) => (
    <div key={b.id}>
      <BlockRow {...p} block={b} />
      {rows(b.children, p)}
    </div>
  ));

/** Frontmatter card and the block tree of the draft. */
export function Outline({ text, apply, onExtract }: { text: string; apply: Apply; onExtract: (id: string) => void }) {
  return (
    <>
      <Frontmatter text={text} apply={apply} />
      {rows(parseSkill(text).blocks, { text, apply, onExtract })}
    </>
  );
}
