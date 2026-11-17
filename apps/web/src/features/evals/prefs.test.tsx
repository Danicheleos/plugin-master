import { MantineProvider } from '@mantine/core';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EvalDataTable } from './EvalDataTable';
import type { Column } from '../../shared/table/types';
import { caseCompareColumns } from './columns';
import {
  EvalPrefsScope,
  copyPrefs,
  updatePrefs,
  useEvalPref,
  useEvalPrefs,
  useOpen,
} from './prefs';

const scoped =
  (widgetId: string) =>
  ({ children }: { children: ReactNode }) => (
    <MantineProvider>
      <EvalPrefsScope spaceId="s" widgetId={widgetId}>
        {children}
      </EvalPrefsScope>
    </MantineProvider>
  );

describe('useEvalPrefs', () => {
  it('starts from the defaults and persists a change', () => {
    const { result } = renderHook(() => useEvalPrefs(), {
      wrapper: scoped('w'),
    });
    expect(result.current[0]).toMatchObject({
      view: 'suites',
      page: null,
      open: {},
      form: { cost: '1', cases: [] },
    });
    act(() => result.current[1](() => ({ view: 'targets' })));
    expect(result.current[0].view).toBe('targets');
    expect(
      JSON.parse(localStorage.getItem('pm.evals.s.w') as string).view,
    ).toBe('targets');
  });

  it('falls back per field on corrupt storage', () => {
    localStorage.setItem(
      'pm.evals.s.bad',
      '{"view":"nope","limit":-3,"open":{"a":true},"form":5}',
    );
    const { result } = renderHook(() => useEvalPrefs(), {
      wrapper: scoped('bad'),
    });
    expect(result.current[0]).toMatchObject({
      view: 'suites',
      open: { a: true },
      form: { cost: '1' },
    });
    expect(result.current[0].limit).toBeUndefined();
    localStorage.setItem('pm.evals.s.junk', 'not json');
    expect(
      renderHook(() => useEvalPrefs(), { wrapper: scoped('junk') }).result
        .current[0].view,
    ).toBe('suites');
  });

  it('works when storage throws', () => {
    const get = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const set = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const { result } = renderHook(() => useEvalPrefs(), {
      wrapper: scoped('mem'),
    });
    act(() => result.current[1](() => ({ view: 'invocations' })));
    expect(result.current[0].view).toBe('invocations');
    get.mockRestore();
    set.mockRestore();
  });

  it('keeps instances independent but each one survives a remount', () => {
    const Probe = ({ id }: { id: string }) => {
      const [open, toggle] = useOpen('k');
      return (
        <button onClick={toggle}>
          {id}:{String(open)}
        </button>
      );
    };
    const Two = () => (
      <MantineProvider>
        <EvalPrefsScope spaceId="s" widgetId="a">
          <Probe id="a" />
        </EvalPrefsScope>
        <EvalPrefsScope spaceId="s" widgetId="b">
          <Probe id="b" />
        </EvalPrefsScope>
      </MantineProvider>
    );
    render(<Two />);
    fireEvent.click(screen.getByText('a:false'));
    expect(screen.getByText('a:true')).toBeTruthy();
    expect(screen.getByText('b:false')).toBeTruthy();
    cleanup();
    render(<Two />);
    expect(screen.getByText('a:true')).toBeTruthy();
    expect(screen.getByText('b:false')).toBeTruthy();
  });

  it('copies the settings of a widget to its duplicate', () => {
    updatePrefs('s.src', () => ({ view: 'targets' }));
    copyPrefs('s', 'src', 'dup');
    expect(
      renderHook(() => useEvalPrefs(), { wrapper: scoped('dup') }).result
        .current[0].view,
    ).toBe('targets');
  });

  it('reads the invocations column ids saved before the shared metric columns', () => {
    localStorage.setItem(
      'pm.evals.s.old',
      '{"columns":{"invocations":["cost","time","model"],"runs":["cost"]}}',
    );
    const { result } = renderHook(() => useEvalPrefs(), {
      wrapper: scoped('old'),
    });
    expect(result.current[0].columns).toEqual({
      invocations: ['costUsd', 'durationMs', 'model'],
      runs: ['cost'],
    });
  });
});

type Row = { name: string; extra?: number };
const columns: Column<Row>[] = [
  {
    id: 'name',
    label: 'Name',
    fixed: true,
    render: (r) => r.name,
    sortValue: (r) => r.name,
  },
  {
    id: 'extra',
    label: 'Extra',
    has: (r) => r.extra !== undefined,
    render: (r) => r.extra,
  },
  { id: 'off', label: 'Off', off: true, render: () => 'off-cell' },
];
const table = (rows: Row[]) => (
  <EvalDataTable
    kind="t"
    columns={columns}
    rows={rows}
    rowKey={(r) => r.name}
  />
);

describe('EvalDataTable', () => {
  it('hides columns without data by default and lets the user choose, persisted per kind', async () => {
    const { rerender } = render(table([{ name: 'a' }]), {
      wrapper: scoped('d'),
    });
    expect(screen.queryByText('Extra')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
    fireEvent.click(screen.getByText('Columns'));
    fireEvent.click(await screen.findByLabelText('Extra'));
    expect(screen.getByRole('columnheader', { name: 'Extra' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Off'));
    expect(screen.getByText('off-cell')).toBeTruthy();
    // another table of the same kind (other rows) uses the same choice
    rerender(table([{ name: 'b', extra: 3 }]));
    expect(screen.getByText('off-cell')).toBeTruthy();
    fireEvent.click(screen.getByText('Reset'));
    expect(screen.queryByText('off-cell')).toBeNull();
    expect(screen.getByText('3')).toBeTruthy(); // data exists: shown by default
  });

  it('sorts by a column header', () => {
    render(table([{ name: 'b' }, { name: 'a' }]), { wrapper: scoped('sort') });
    const first = () => expect(screen.getAllByRole('row')[1]);
    first().toHaveProperty('textContent', 'b');
    fireEvent.click(screen.getByText('Name'));
    first().toHaveProperty('textContent', 'a');
  });
});

it('caseCompareColumns has a Traces column only with onTrace', () => {
  expect(caseCompareColumns({}).map((c) => c.id)).not.toContain('traces');
  expect(
    caseCompareColumns({ onTrace: () => undefined }).map((c) => c.id),
  ).toContain('traces');
});

describe('per-key subscriptions', () => {
  it('re-renders only the consumers of the toggled key', () => {
    const renders = { a: 0, b: 0 };
    const Row = ({ k }: { k: 'a' | 'b' }) => {
      const [open, toggle] = useOpen(`row:${k}`);
      renders[k]++;
      return (
        <button onClick={toggle} aria-label={k}>
          {String(open)}
        </button>
      );
    };
    const Wrapper = scoped('perkey');
    render(
      <Wrapper>
        <Row k="a" />
        <Row k="b" />
      </Wrapper>,
    );
    expect(renders).toEqual({ a: 1, b: 1 });
    fireEvent.click(screen.getByLabelText('a'));
    expect(screen.getAllByText('true')).toHaveLength(1);
    expect(renders.a).toBe(2);
    expect(renders.b).toBe(1);
    // an unrelated setting does not re-render them either
    act(() => updatePrefs('s.perkey', () => ({ view: 'targets' })));
    expect(renders).toEqual({ a: 2, b: 1 });
  });

  it('useEvalPref follows its selector', () => {
    const { result } = renderHook(() => useEvalPref((p) => p.view), {
      wrapper: scoped('sel'),
    });
    expect(result.current).toBe('suites');
    act(() => updatePrefs('s.sel', () => ({ view: 'invocations' })));
    expect(result.current).toBe('invocations');
  });
});
