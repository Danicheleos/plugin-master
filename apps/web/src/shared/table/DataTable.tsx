import {
  Fragment,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Table } from '@mantine/core';
import { PickMenu } from './PickMenu';
import type { Column } from './types';

export type { Column };

const defaultOn = <R,>(c: Column<R>, rows: R[]) =>
  !c.off && (!c.has || rows.some(c.has));

/**
 * Visible columns: the `chosen` ids (persisted by the caller via `onChosenChange`), else the
 * data-driven default. Without `onChosenChange` the choice is kept in local state.
 */
export function useColumns<R>(
  columns: Column<R>[],
  rows: R[],
  controlled?: {
    chosen: string[] | undefined;
    onChosenChange: (ids: string[] | undefined) => void;
  },
) {
  const [local, setLocal] = useState<string[] | undefined>();
  const chosen = controlled ? controlled.chosen : local;
  const optional = columns.filter((c) => !c.fixed);
  const selected = new Set(
    optional
      .filter((c) => (chosen ? chosen.includes(c.id) : defaultOn(c, rows)))
      .map((c) => c.id),
  );
  const set = controlled ? controlled.onChosenChange : setLocal;
  const picker = (
    <PickMenu
      label="Columns"
      items={optional.map((c) => ({ id: c.id, title: c.title ?? c.label }))}
      selected={selected}
      onChange={set}
      onReset={() => set(undefined)}
    />
  );
  return {
    visible: columns.filter((c) => c.fixed || selected.has(c.id)),
    picker,
  };
}

const compare = (a?: number | string, b?: number | string) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1;

/**
 * One table for every list: columns come from a registry and the visible set is chosen with the
 * "Columns" menu. `detail` returns an extra full-width row under a row (null = none).
 */
export function DataTable<R>({
  chosen,
  onChosenChange,
  columns,
  rows,
  rowKey,
  onRowClick,
  rowBg,
  detail,
  picker = true,
  fz,
  highlightOnHover,
}: {
  /** Persisted column choice (ids); undefined = data-driven default. */
  chosen?: string[];
  onChosenChange?: (ids: string[] | undefined) => void;
  columns: Column<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  onRowClick?: (r: R) => void;
  rowBg?: (r: R) => string | undefined;
  detail?: (r: R) => ReactNode;
  picker?: boolean;
  fz?: 'xs';
  highlightOnHover?: boolean;
}) {
  const { visible, picker: menu } = useColumns(
    columns,
    rows,
    onChosenChange && { chosen, onChosenChange },
  );
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>();
  const toggleSort = (id: string) =>
    setSort(
      sort?.id !== id
        ? { id, dir: 1 }
        : sort.dir === 1
          ? { id, dir: -1 }
          : undefined,
    );
  const by = sort && visible.find((c) => c.id === sort.id)?.sortValue;
  const dir = sort?.dir;
  const shown = useMemo(
    () =>
      by && dir ? [...rows].sort((a, b) => compare(by(a), by(b)) * dir) : rows,
    [rows, by, dir],
  );
  return (
    <>
      {picker && menu}
      <Table fz={fz} highlightOnHover={highlightOnHover}>
        <Table.Thead>
          <Table.Tr>
            {visible.map((c) => (
              <Table.Th
                key={c.id}
                ta={c.align}
                aria-sort={
                  sort?.id === c.id
                    ? sort.dir === 1
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                {...(c.sortValue && {
                  style: { cursor: 'pointer' },
                  tabIndex: 0,
                  onClick: () => toggleSort(c.id),
                  onKeyDown: (e: KeyboardEvent) =>
                    e.key === 'Enter' && toggleSort(c.id),
                })}
              >
                {c.label}
                {sort?.id === c.id && (sort.dir === 1 ? ' ▴' : ' ▾')}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {shown.map((r) => {
            const extra = detail?.(r);
            return (
              <Fragment key={rowKey(r)}>
                <Table.Tr
                  bg={rowBg?.(r)}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                  onClick={onRowClick && (() => onRowClick(r))}
                >
                  {visible.map((c) => (
                    <Table.Td key={c.id} ta={c.align}>
                      {c.render(r)}
                    </Table.Td>
                  ))}
                </Table.Tr>
                {extra && (
                  <Table.Tr>
                    <Table.Td colSpan={visible.length}>{extra}</Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </>
  );
}
