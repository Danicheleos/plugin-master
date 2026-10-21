import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Table } from '@mantine/core';
import { PickMenu } from './PickMenu';
import { useEvalPrefs } from './prefs';

export type Column<R> = {
  id: string;
  /** header */
  label: string;
  /** name in the column picker (default: `label`) */
  title?: string;
  align?: 'right';
  render: (r: R) => ReactNode;
  sortValue?: (r: R) => number | string | undefined;
  /** Always shown and not in the picker (the row's identity). */
  fixed?: boolean;
  /** Default hidden unless some row has data. */
  has?: (r: R) => boolean;
  /** Default hidden (selectable). */
  off?: boolean;
};

const defaultOn = <R,>(c: Column<R>, rows: R[]) => !c.off && (!c.has || rows.some(c.has));

/** Visible columns of a table `kind`: the persisted choice, else the data-driven default. */
export function useColumns<R>(kind: string, columns: Column<R>[], rows: R[]) {
  const [prefs, update] = useEvalPrefs();
  const chosen = prefs.columns[kind];
  const optional = columns.filter((c) => !c.fixed);
  const selected = new Set(optional.filter((c) => (chosen ? chosen.includes(c.id) : defaultOn(c, rows))).map((c) => c.id));
  const set = (ids: string[] | undefined) =>
    update((p) => {
      const columns = { ...p.columns };
      if (ids) columns[kind] = ids;
      else delete columns[kind];
      return { columns };
    });
  const picker = (
    <PickMenu
      label="Columns"
      items={optional.map((c) => ({ id: c.id, title: c.title ?? c.label }))}
      selected={selected}
      onChange={set}
      onReset={() => set(undefined)}
    />
  );
  return { visible: columns.filter((c) => c.fixed || selected.has(c.id)), picker };
}

const compare = (a?: number | string, b?: number | string) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1;

/**
 * One table for every list (runs of a case, cases of a suite or run, invocations): columns come
 * from a registry per `kind`, and the visible set is chosen with the "Columns" menu for all
 * tables of that kind. `detail` returns an extra full-width row under a row (null = none).
 */
export function DataTable<R>({
  kind,
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
  kind: string;
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
  const { visible, picker: menu } = useColumns(kind, columns, rows);
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>();
  const toggleSort = (id: string) =>
    setSort(sort?.id !== id ? { id, dir: 1 } : sort.dir === 1 ? { id, dir: -1 } : undefined);
  const by = sort && visible.find((c) => c.id === sort.id)?.sortValue;
  const shown = by && sort ? [...rows].sort((a, b) => compare(by(a), by(b)) * sort.dir) : rows;
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
                aria-sort={sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                {...(c.sortValue && {
                  style: { cursor: 'pointer' },
                  tabIndex: 0,
                  onClick: () => toggleSort(c.id),
                  onKeyDown: (e: KeyboardEvent) => e.key === 'Enter' && toggleSort(c.id),
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
                <Table.Tr bg={rowBg?.(r)} style={onRowClick ? { cursor: 'pointer' } : undefined} onClick={onRowClick && (() => onRowClick(r))}>
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
