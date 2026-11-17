import type { ReactNode } from 'react';

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
