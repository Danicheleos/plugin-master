import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MetricChart } from './MetricChart';

// the spec tsconfig has no DOM lib
type El = { getAttribute(n: string): string | null; querySelector(s: string): El | null };
const fmt = (v?: number) => `${v}x`;

describe('MetricChart', () => {
  it('renders nothing without points and the last value as caption', () => {
    const { rerender } = render(<MetricChart points={[]} label="Cost" format={fmt} />);
    expect(screen.queryByLabelText('Cost')).toBeNull();
    rerender(<MetricChart points={[{ key: 'a', value: 1 }, { key: 'b', value: 3 }]} label="Cost" format={fmt} />);
    expect(screen.getAllByText('3x').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Cost')).toBeTruthy();
  });

  it('scales each chart by its own max, line skips hollow points, tooltip and pick', () => {
    const onPick = vi.fn();
    const { container } = render(
      <MetricChart
        points={[
          { key: 'a', value: 5, title: 'tip a' },
          { key: 'b', value: 10, hollow: true },
          { key: 'c', value: 0, picked: true },
        ]}
        label="Turns"
        format={fmt}
        onPick={onPick}
      />,
    );
    const cy = (k: string) => Number((screen.getByTestId(`point-${k}`) as unknown as El).getAttribute('cy'));
    expect(cy('b')).toBeLessThan(cy('a')); // 10 is the top of this chart's scale
    expect(cy('a')).toBeLessThan(cy('c'));
    expect((container as unknown as El).querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
    expect(screen.getByText('tip a')).toBeTruthy();
    fireEvent.click(screen.getByTestId('point-b'));
    expect(onPick).toHaveBeenCalledWith('b');
  });

  it('draws the baseline on the shared scale, only for matching points', () => {
    const { container } = render(
      <MetricChart
        points={[{ key: 'a', value: 2 }, { key: 'b', value: 4 }]}
        baseline={[{ key: 'b', value: 8 }, { key: 'zz', value: 1 }]}
        label="Cost"
        format={fmt}
      />,
    );
    const cy = (id: string) => Number((screen.getByTestId(id) as unknown as El).getAttribute('cy'));
    expect(cy('baseline-b')).toBeLessThan(cy('point-b')); // 8 sets the top of the scale
    expect(screen.queryByTestId('baseline-zz')).toBeNull();
    expect(screen.getByText('Baseline 8x')).toBeTruthy();
    expect(screen.getByText(/dashed: baseline/)).toBeTruthy();
    expect((container as unknown as El).querySelector('polyline[stroke-dasharray]')).toBeTruthy();
  });

  it('draws nothing extra without baseline', () => {
    render(<MetricChart points={[{ key: 'a', value: 2 }]} label="Cost" format={fmt} />);
    expect(screen.queryByTestId('baseline-a')).toBeNull();
    expect(screen.queryByText(/dashed/)).toBeNull();
  });

  it('ignores NaN values and renders nothing when none is finite', () => {
    const { container } = render(
      <MetricChart points={[{ key: 'a', value: NaN }, { key: 'b', value: 2 }]} label="Cost" format={fmt} />,
    );
    expect(screen.queryByTestId('point-a')).toBeNull();
    expect((container as unknown as { innerHTML: string }).innerHTML).not.toContain('NaN');
    const { container: c2 } = render(<MetricChart points={[{ key: 'a', value: NaN }]} label="X" format={fmt} />);
    expect((c2 as unknown as { innerHTML: string }).innerHTML).toBe('');
  });

  it('shows the nearest point value and baseline on hover, clicks still pick', () => {
    const onPick = vi.fn();
    render(
      <MetricChart
        points={[{ key: 'a', value: 2, title: 'run a' }, { key: 'b', value: 4 }]}
        baseline={[{ key: 'b', value: 8 }]}
        label="Cost"
        format={fmt}
        onPick={onPick}
      />,
    );
    expect(screen.queryByTestId('chart-tip')).toBeNull();
    const wrap = (screen.getByLabelText('Cost') as unknown as { parentElement: unknown }).parentElement as { getBoundingClientRect(): unknown };
    wrap.getBoundingClientRect = () => ({ left: 0, width: 300 });
    const text = (id: string) => (screen.getByTestId(id) as unknown as { textContent: string }).textContent;
    fireEvent.mouseMove(wrap, { clientX: 290 });
    expect(text('chart-tip')).toContain('4x');
    expect(text('chart-tip')).toContain('baseline 8x');
    fireEvent.mouseMove(wrap, { clientX: 5 });
    expect(text('chart-tip')).toContain('run a');
    fireEvent.click(screen.getByTestId('point-b'));
    expect(onPick).toHaveBeenCalledWith('b');
    fireEvent.mouseLeave(wrap);
    expect(screen.queryByTestId('chart-tip')).toBeNull();
  });
});
