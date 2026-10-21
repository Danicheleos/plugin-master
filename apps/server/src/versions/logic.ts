import {
  parseSkill,
  type CaseCompare,
  type CaseSide,
  type GateRule,
  type GateStatus,
  type PmMeta,
  type VersionSide,
  type VersionsCompare,
  type VersionsGate,
} from '@pm/protocol';
import { caseRegressed, suiteDelta } from '../evals/stats';

/** Context cost of a skill/agent file: bytes of its frontmatter `description` + body (what loads into context). */
export function contextBytes(src: string): number {
  const fm = parseSkill(src).frontmatter;
  const desc = (fm?.data as { description?: unknown } | null)?.description;
  return Buffer.byteLength(typeof desc === 'string' ? desc : '') + Buffer.byteLength(src.slice(fm?.end ?? 0));
}

export type LogEntry = { hash: string; tree: string; /** commit time, ms */ time: number };
export type Resolved = { hash: string; approx: boolean; dirty: boolean };

/**
 * Commit an eval run belongs to. Sidecar: its commit, or (when the commit is gone from `log`, e.g.
 * after a rebase) the commit with the same tree. Without a sidecar: the first (newest) entry of
 * `log` committed at or before `startedAt`, flagged approximate. `undefined` = no match.
 */
export function resolveCommit(
  meta: PmMeta | undefined,
  startedAt: string | undefined,
  log: LogEntry[],
): Resolved | undefined {
  if (meta) {
    const hit = log.find((c) => c.hash === meta.commit) ?? log.find((c) => c.tree === meta.tree);
    return { hash: hit?.hash ?? meta.commit, approx: false, dirty: meta.dirty };
  }
  const t = Date.parse(startedAt ?? '');
  const hit = Number.isNaN(t) ? undefined : log.find((c) => c.time <= t);
  return hit && { hash: hit.hash, approx: true, dirty: false };
}

/** Per-case rows over the union of names (`from` order first); `delta` needs both scores. */
export function compareCases(
  from: (CaseSide & { name: string })[],
  to: (CaseSide & { name: string })[],
): CaseCompare[] {
  const side = ({ name: _n, ...s }: CaseSide & { name: string }): CaseSide => s;
  const f = new Map(from.map((c) => [c.name, c]));
  const t = new Map(to.map((c) => [c.name, c]));
  return [...new Set([...f.keys(), ...t.keys()])].map((name) => {
    const a = f.get(name);
    const b = t.get(name);
    return {
      name,
      ...(a && { from: side(a) }),
      ...(b && { to: side(b) }),
      ...(a?.score !== undefined && b?.score !== undefined && { delta: b.score - a.score }),
    };
  });
}

/** Suite-level paired delta over the cases that have a score on both versions. */
export const suiteOf = (cases: CaseCompare[]) => suiteDelta(cases.map((c) => c.delta));

const worst = (rules: GateRule[]): GateStatus =>
  rules.some((r) => r.status === 'fail') ? 'fail' : rules.some((r) => r.status === 'unknown') ? 'unknown' : 'pass';

/** No data is never a pass. `holdout` = names of the `to` suite's cases tagged `holdout`. */
export function evaluateGate(
  from: VersionSide,
  to: VersionSide,
  cases: CaseCompare[],
  skill: Pick<VersionsCompare['skillContext'], 'fromBytes' | 'toBytes'>,
  holdout: string[],
): VersionsGate {
  const worse = cases.filter((c) => (c.delta ?? 0) < 0).map((c) => c.name);
  const compared = cases.some((c) => c.delta !== undefined);
  const suite = suiteOf(cases);
  // blocks a significant suite-level drop or a case that dropped beyond its own noise; other lower cases are a warning
  const sig = cases.filter((c) => c.from && c.to && caseRegressed({ n: c.from.runs, mean: c.from.score, sd: c.from.sd }, { n: c.to.runs, mean: c.to.score, sd: c.to.sd })).map((c) => c.name);
  const noisy = worse.length > 0 && suite.verdict !== 'regressed' && !sig.length;
  const noReg: GateRule = suite.verdict === 'regressed' || sig.length
    ? {
        id: 'no-regression',
        status: 'fail',
        message: sig.length ? `${sig.length} case(s) dropped significantly` : `Suite scored lower (${worse.length} case(s) lower)`,
        cases: sig.length ? sig : worse,
      }
    : compared
      ? { id: 'no-regression', status: 'pass', message: noisy ? `${worse.length} case(s) scored lower, not significant` : 'No case scored lower' }
      : { id: 'no-regression', status: 'unknown', message: 'No case has a score on both versions' };

  const ctx: GateRule =
    !skill.fromBytes && !skill.toBytes
      ? { id: 'ctx-not-grown', status: 'unknown', message: 'No SKILL.md on either version' }
      : skill.toBytes > skill.fromBytes
        ? { id: 'ctx-not-grown', status: 'fail', message: `Skill context grew ${skill.fromBytes} -> ${skill.toBytes} bytes` }
        : { id: 'ctx-not-grown', status: 'pass', message: `Skill context ${skill.fromBytes} -> ${skill.toBytes} bytes` };

  const rows = holdout.map((name) => cases.find((c) => c.name === name)?.to);
  const missing = holdout.filter((_n, i) => rows[i]?.passed === undefined);
  const failed = holdout.filter((_n, i) => rows[i]?.passed === false);
  const hold: GateRule = failed.length
    ? { id: 'holdout-pass', status: 'fail', message: `${failed.length} holdout case(s) failed`, cases: failed }
    : !holdout.length
      ? { id: 'holdout-pass', status: 'unknown', message: 'No case is tagged holdout' }
      : missing.length
        ? { id: 'holdout-pass', status: 'unknown', message: `${missing.length} holdout case(s) have no result`, cases: missing }
        : { id: 'holdout-pass', status: 'pass', message: 'All holdout cases passed' };

  const rules = [noReg, ctx, hold];
  const warn = (v: VersionSide, label: string) => [
    ...(v.dirty ? [`${label} results come from a dirty tree`] : []),
    ...(v.approx ? [`${label} results are matched to the commit by time`] : []),
  ];
  const stats = [
    ...(compared && suite.verdict === 'inconclusive'
      ? [`Score change is inconclusive (${suite.cases} case(s)${suite.ci ? `, 95% CI crosses 0` : ', too few for an interval'})`]
      : []),
    ...(cases.some((c) => c.from?.flaky || c.to?.flaky) ? ['Some cases are flaky: their runs disagree'] : []),
  ];
  return { from, to, status: worst(rules), rules, warnings: [...warn(from, 'From'), ...warn(to, 'To'), ...stats], suite };
}
