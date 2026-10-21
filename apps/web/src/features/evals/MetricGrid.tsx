import { Group, NumberInput } from '@mantine/core';
import { MetricChart } from './MetricChart';
import { PickMenu } from './PickMenu';
import { METRICS, type MetricRun } from './metrics';
import { useEvalPrefs } from './prefs';
import { stamp } from './format';
import styles from './evals.module.scss';

/**
 * One chart per metric with at least two values over the runs of a section, oldest left. The
 * "Charts" menu picks the metrics to draw and "Last runs" limits the runs plotted (both persisted,
 * apply to every chart set of the widget).
 */
export function MetricGrid({ runs }: { runs: MetricRun[] }) {
  const [prefs, update] = useEvalPrefs();
  const ordered = runs.slice(0, prefs.limit).reverse(); // `runs` are newest first
  const charts = METRICS.flatMap((m) => {
    const points = ordered.flatMap((r) => {
      const value = m.get(r);
      if (value === undefined) return [];
      const when = stamp(r.startedAt) ?? r.runId;
      const b = m.get(r.baselineMetrics ?? {});
      const vs = b === undefined ? '' : ` (baseline ${m.format(b)})`;
      return [{ key: r.runId, value, title: `${when} · ${m.format(value)}${vs}${r.commit ? ` · ${r.commit.slice(0, 7)}` : ''}` }];
    });
    const baseline = ordered.flatMap((r) => {
      const value = m.get(r.baselineMetrics ?? {});
      return value === undefined ? [] : [{ key: r.runId, value }];
    });
    return points.length > 1 ? [{ ...m, points, baseline }] : [];
  });
  if (runs.length < 2) return null;
  const selected = new Set(prefs.charts ?? charts.map((c) => c.id));
  const set = (ids: string[] | undefined) => update(() => ({ charts: ids }));
  return (
    <>
      <Group gap="xs" align="flex-end" mb="xs">
        <PickMenu
          label="Charts"
          items={METRICS.map((m) => ({ id: m.id, title: m.label }))}
          selected={selected}
          onChange={set}
          onReset={() => set(undefined)}
        />
        <NumberInput
          size="xs"
          w={110}
          aria-label="Last runs plotted"
          placeholder="All runs"
          min={1}
          allowDecimal={false}
          value={prefs.limit ?? ''}
          onChange={(v) => update(() => ({ limit: typeof v === 'number' && v > 0 ? v : undefined }))}
        />
      </Group>
      <div className={styles.metrics}>
        {charts.filter((c) => selected.has(c.id)).map((m) => (
          <MetricChart key={m.id} label={m.label} points={m.points} baseline={m.baseline} format={m.format} max={m.max} className={styles.gridMetric} height={80} />
        ))}
      </div>
    </>
  );
}
