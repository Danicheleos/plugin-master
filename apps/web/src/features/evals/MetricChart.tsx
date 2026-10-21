import { useState } from 'react';
import styles from './evals.module.scss';

export type MetricPoint = {
  key: string;
  value: number;
  /** Tooltip. */
  title?: string;
  /** Drawn hollow and left out of the line (e.g. a partial run). */
  hollow?: boolean;
  picked?: boolean;
};

const [W, PAD] = [300, 6];

/**
 * One metric over points in order (oldest left) as a small SVG line chart with its own y-scale
 * from 0 to the largest value (or `max`). `onPick` makes the points clickable. `baseline` values
 * (`key` = a point's key) are drawn as a dashed second series on the same scale.
 */
export function MetricChart({
  points: all,
  label,
  format,
  max,
  baseline: allBase = [],
  onPick,
  className = styles.metric,
  height: H = 56,
}: {
  points: MetricPoint[];
  label: string;
  format: (v?: number) => string;
  max?: number;
  baseline?: { key: string; value: number }[];
  onPick?: (key: string) => void;
  className?: string;
  /** viewBox height; the chart scales with its width, so this sets the aspect ratio. */
  height?: number;
}) {
  const [hover, setHover] = useState<number>();
  // NaN/Infinity would poison the scale and the SVG attributes
  const points = all.filter((p) => Number.isFinite(p.value));
  const baseline = allBase.filter((b) => Number.isFinite(b.value));
  if (!points.length) return null;
  const top = max ?? (Math.max(...points.map((p) => p.value), ...baseline.map((b) => b.value)) || 1);
  const x = (i: number) => (points.length < 2 ? W / 2 : PAD + (i / (points.length - 1)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - Math.min(Math.max(v / top, 0), 1) * (H - 2 * PAD);
  const line = points.flatMap((p, i) => (p.hollow ? [] : [`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`]));
  const base = baseline.flatMap((b) => {
    const i = points.findIndex((p) => p.key === b.key);
    return i < 0 ? [] : [{ ...b, cx: x(i), cy: y(b.value) }];
  });
  const hp = hover === undefined ? undefined : points[hover];
  const hb = hp && baseline.find((b) => b.key === hp.key);
  const last = points[points.length - 1] as MetricPoint;
  return (
    <figure className={className}>
      <figcaption>
        {label} <b>{format(last.value)}</b>
        {base.length > 0 && <span className={styles.legend}> solid: plugin, dashed: baseline</span>}
      </figcaption>
      <div
        className={styles.chartWrap}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
          setHover(points.reduce((best, _, i) => (Math.abs(x(i) - f * W) < Math.abs(x(best) - f * W) ? i : best), 0));
        }}
        onMouseLeave={() => setHover(undefined)}
      >
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {hp && <line className={styles.guide} x1={x(hover as number)} x2={x(hover as number)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />}
        <line className={styles.axis} x1={0} x2={W} y1={y(0)} y2={y(0)} />
        <polyline points={line.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {base.length > 0 && (
          <g className={styles.baseline}>
            <polyline points={base.map((b) => `${b.cx.toFixed(1)},${b.cy.toFixed(1)}`).join(' ')} fill="none" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            {base.map((b) => (
              <circle key={b.key} data-testid={`baseline-${b.key}`} cx={b.cx} cy={b.cy} r={2}>
                <title>{`Baseline ${format(b.value)}`}</title>
              </circle>
            ))}
          </g>
        )}
        {points.map((p, i) => (
          <circle
            key={p.key}
            data-testid={`point-${p.key}`}
            className={`${p.hollow ? styles.hollow : styles.mark} ${p.picked ? styles.picked : ''} ${onPick ? styles.pickable : ''}`}
            stroke="currentColor"
            cx={x(i)}
            cy={y(p.value)}
            r={3.5}
            onClick={onPick && (() => onPick(p.key))}
          >
            <title>{p.title ?? `${format(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      {hp && (
        <div className={styles.chartTip} data-testid="chart-tip" style={{ left: `${(x(hover as number) / W) * 100}%` }}>
          {hp.title && <div>{hp.title}</div>}
          <b>{format(hp.value)}</b>
          {hb && <div>baseline {format(hb.value)}</div>}
        </div>
      )}
      </div>
    </figure>
  );
}
