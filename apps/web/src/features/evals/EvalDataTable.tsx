import type { ComponentProps } from 'react';
import { DataTable } from '../../shared/table/DataTable';
import { useEvalPrefs } from './prefs';

type Props<R> = Omit<
  ComponentProps<typeof DataTable<R>>,
  'chosen' | 'onChosenChange'
> & {
  /** Table kind: its "Columns" choice is saved for all tables of that kind. */
  kind: string;
};

/**
 * `DataTable` with the visible columns persisted per `kind` in the evals prefs
 * (`pm.evals.<spaceId>.<widgetId>`).
 */
export function EvalDataTable<R>({ kind, ...props }: Props<R>) {
  const [prefs, update] = useEvalPrefs();
  const onChosenChange = (ids: string[] | undefined) =>
    update((p) => {
      const columns = { ...p.columns };
      if (ids) columns[kind] = ids;
      else delete columns[kind];
      return { columns };
    });
  return (
    <DataTable<R>
      {...props}
      chosen={prefs.columns[kind]}
      onChosenChange={onChosenChange}
    />
  );
}
