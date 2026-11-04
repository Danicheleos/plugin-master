import { useMemo, useState } from 'react';
import { Anchor, Badge, Code, Text } from '@mantine/core';
import { parseDetail } from './details';
import styles from './evals.module.scss';

const LONG = 80;

function Value({ value, depth }: { value: unknown; depth: number }) {
  if (typeof value === 'string')
    return value.length > LONG || value.includes('\n') ? (
      <Code block fz="xs">
        {value}
      </Code>
    ) : (
      <Text span size="xs" ff="monospace">
        {JSON.stringify(value)}
      </Text>
    );
  if (typeof value === 'object' && value !== null)
    return <Node value={value} depth={depth + 1} />;
  return (
    <Text span size="xs" ff="monospace">
      {String(value)}
    </Text>
  );
}

/** Key/value rows of an object or array; nested ones below the first level start collapsed (and unmounted). */
function Node({ value, depth }: { value: object; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const entries = Object.entries(value);
  const shape = Array.isArray(value)
    ? `[${entries.length}]`
    : `{${entries.length}}`;
  if (!entries.length)
    return (
      <Text span size="xs" ff="monospace">
        {Array.isArray(value) ? '[]' : '{}'}
      </Text>
    );
  return (
    <>
      {depth > 0 && (
        <Anchor
          component="button"
          size="xs"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'} {shape}
        </Anchor>
      )}
      {open && (
        <div className={depth > 0 ? styles.detailNested : undefined}>
          {entries.map(([k, v]) => (
            <div key={k} className={styles.detailRow}>
              <Text span size="xs" fw={600} ff="monospace">
                {k}:
              </Text>{' '}
              <Value value={v} depth={depth} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * A tool input or result for reading: JSON as nested key/value rows, content blocks as their text
 * (other blocks as a label), decoded JSON strings with real newlines, anything else as raw text.
 * Mount it only when shown: it parses on mount.
 */
export function DetailView({ text, color }: { text: string; color?: string }) {
  const d = useMemo(() => parseDetail(text), [text]);
  if (d.kind === 'json')
    return (
      <div className={styles.detail}>
        <Node value={d.value} depth={0} />
      </div>
    );
  if (d.kind === 'blocks')
    return (
      <div className={styles.detail}>
        {d.parts.map((p, i) =>
          'text' in p ? (
            <Code key={i} block fz="xs" c={color}>
              {p.text}
            </Code>
          ) : (
            <Badge key={i} size="xs" variant="outline">
              {p.label}
            </Badge>
          ),
        )}
      </div>
    );
  return (
    <Code block fz="xs" c={color}>
      {d.text || '(empty)'}
    </Code>
  );
}
