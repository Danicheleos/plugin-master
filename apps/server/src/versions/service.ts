import {
  type CaseSide,
  type EvalCase,
  type EvalGroup,
  type VersionEntry,
  type VersionSide,
  type VersionsCompare,
  type VersionsGate,
  type VersionsResponse,
  type SkillSize,
} from '@pm/protocol';
import { evalDir } from '../evals/eval-dir';
import { groupRuns, type RunInput } from '../evals/groups';
import { loadRuns, mean, readMerged } from '../evals/results';
import { caseStats } from '../evals/stats';
import { readSuite } from '../evals/suite';
import { inRepo } from '../git/service';
import { AppError } from '../lib/errors';
import { compareCases, contextBytes, evaluateGate, resolveCommit, suiteOf, type LogEntry } from './logic';
import { readMeta } from './sidecar';

/** Commits scanned to map runs to commits; the list shows the first `limit`. */
const SCAN = 500;
const MAX_FILES = 200;
const MAX_SKILLS = 100;
/** Never starts with `-`; `^{commit}` is appended before git sees it. */
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/@~^{}-]*$/;

type Commit = LogEntry & { date: string; author: string; message: string };

const readLog = (root: string): Promise<Commit[]> =>
  inRepo(root, async (git) => {
    if (!(await git.raw(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => ''))) return [];
    const raw = await git.raw(['log', `--max-count=${SCAN}`, '--format=%H%x1f%T%x1f%ct%x1f%cI%x1f%an%x1f%s%x1e']);
    return raw
      .split('\x1e')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [hash, tree, ct, date, author, ...msg] = r.split('\x1f');
        return { hash, tree, time: Number(ct) * 1000, date, author, message: msg.join('\x1f') };
      });
  });

/** Full sha of a user-supplied ref; the ref is checked before it reaches git. */
async function verifyRef(root: string, ref: string): Promise<string> {
  const bad = () => new AppError('INVALID_REF', `Invalid or unknown ref "${ref}"`, 400);
  if (!REF_RE.test(ref)) throw bad();
  const sha = await inRepo(root, async (git) =>
    (await git.raw(['rev-parse', '--verify', '-q', `${ref}^{commit}`]).catch(() => '')).trim(),
  );
  if (!sha) throw bad();
  return sha;
}

type CommitGroup = { group: EvalGroup; approx: boolean; dirty: boolean };
const trendable = (g: EvalGroup) => !g.partial && !g.skippedPaid;

/** Eval groups per commit (newest first). Runs are grouped within one commit only. */
async function commitGroups(root: string, log: Commit[]): Promise<Map<string, CommitGroup[]>> {
  const dir = await evalDir(root);
  type Flags = Map<string, { approx: boolean; dirty: boolean }>;
  const byCommit = new Map<string, { inputs: RunInput[]; flags: Flags }>();
  for (const input of await loadRuns(root)) {
    const { id, startedAt, error, ablation } = input.summary;
    if (error || ablation === 'without') continue; // a baseline-only run is not a point of the plugin
    const r = resolveCommit(await readMeta(root, dir, id), startedAt, log);
    if (!r) continue;
    const b = byCommit.get(r.hash) ?? { inputs: [] as RunInput[], flags: new Map() as Flags };
    b.inputs.push(input);
    b.flags.set(id, r);
    byCommit.set(r.hash, b);
  }
  return new Map(
    [...byCommit].map(([hash, { inputs, flags }]) => [
      hash,
      groupRuns(inputs)
        .filter((g) => !g.error)
        .map((group) => ({
          group,
          approx: group.runIds.some((id) => flags.get(id)?.approx),
          dirty: group.runIds.some((id) => flags.get(id)?.dirty),
        })),
    ]),
  );
}

export async function listVersions(root: string, limit: number): Promise<VersionsResponse> {
  const log = await readLog(root);
  const groups = await commitGroups(root, log);
  let prev: number | undefined;
  const commits: VersionEntry[] = [];
  for (const c of [...log].reverse()) {
    // oldest first so every commit knows the previous trendable score
    const list = groups.get(c.hash) ?? [];
    const pick = list.find((x) => trendable(x.group)) ?? list[0];
    const g = pick?.group;
    const score = g?.score;
    const ok = !!pick && trendable(pick.group) && score !== undefined;
    commits.push({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author: c.author,
      ...(pick && g && {
        eval: {
          groupId: g.id,
          runIds: g.runIds,
          score: g.score,
          casesPassed: g.casesPassed,
          casesTotal: g.casesTotal,
          costUsd: g.costUsd,
          ...(g.partial && { partial: true }),
          ...(g.skippedPaid && { skippedPaid: true }),
          ...(pick.approx && { approx: true }),
          ...(pick.dirty && { dirty: true }),
        },
      }),
      trendable: ok,
      ...(ok && prev !== undefined && { delta: score - prev }),
    });
    if (ok) prev = score;
  }
  return { commits: commits.reverse().slice(0, limit) };
}

const side = (c: EvalCase): CaseSide => {
  const w = c.arms.with;
  const failed = w.findIndex((x) => x.passed !== true);
  const st = caseStats(w);
  return {
    ...(c.runId && w.length && { runId: c.runId, arm: 'with' as const, n: Math.max(failed, 0) + 1 }),
    score: c.aggregates.score ?? mean(w.map((x) => x.score)),
    costUsd: mean(w.map((x) => (x.costUsd === undefined ? undefined : x.costUsd + (x.judgeCostUsd ?? 0)))),
    maxContext: mean(w.map((x) => x.traceMetrics?.maxContext)),
    turns: mean(w.map((x) => x.traceMetrics?.numTurns ?? x.turns)),
    ...(w.length && { runs: w.length, flaky: st.flaky }),
    ...(st.sd !== undefined && { sd: st.sd }),
    passed: w.length ? w.every((x) => x.passed === true) : undefined,
  };
};

/** The latest non-partial merged group of a commit: its cases and what it was matched by. */
async function commitCases(root: string, hash: string, groups: Map<string, CommitGroup[]>) {
  const pick = groups.get(hash)?.find((x) => !x.group.partial);
  let cases: (CaseSide & { name: string })[] = [];
  if (pick) {
    try {
      cases = (await readMerged(root, pick.group)).cases.map((c) => ({ name: c.name, ...side(c) }));
    } catch {
      // unreadable run: no data for this commit
    }
  }
  const v: VersionSide = {
    hash,
    ...(pick && { groupId: pick.group.id }),
    ...(pick?.approx && { approx: true }),
    ...(pick?.dirty && { dirty: true }),
  };
  return { cases, side: v };
}

/** Bytes of description + body of every `skills/<name>/SKILL.md` at `sha`. */
const skillSizes = (root: string, sha: string): Promise<SkillSize[]> =>
  inRepo(root, async (git) => {
    const files = (await git.raw(['ls-tree', '-r', '--name-only', '-z', sha, '--', 'skills']))
      .split('\0')
      .filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f))
      .slice(0, MAX_SKILLS);
    return Promise.all(
      files.map(async (f) => {
        const src = await git.raw(['show', `${sha}:${f}`]);
        return { skill: f.split('/')[1], bytes: contextBytes(src) };
      }),
    );
  });

const changedFiles = (root: string, from: string, to: string) =>
  inRepo(root, async (git) => {
    const t = (await git.raw(['diff', '--name-status', '-z', '--no-renames', from, to])).split('\0');
    const files: { status: string; path: string }[] = [];
    for (let i = 0; i + 1 < t.length && files.length < MAX_FILES; i += 2) files.push({ status: t[i], path: t[i + 1] });
    return files;
  });

export async function compareVersions(root: string, fromRef: string, toRef: string): Promise<VersionsCompare> {
  const [from, to] = [await verifyRef(root, fromRef), await verifyRef(root, toRef)];
  const groups = await commitGroups(root, await readLog(root));
  const [a, b] = [await commitCases(root, from, groups), await commitCases(root, to, groups)];
  const [sa, sb] = [await skillSizes(root, from), await skillSizes(root, to)];
  const sum = (s: SkillSize[]) => s.reduce((n, x) => n + x.bytes, 0);
  const cases = compareCases(a.cases, b.cases);
  return {
    from: a.side,
    to: b.side,
    files: await changedFiles(root, from, to),
    cases,
    suite: suiteOf(cases),
    skillContext: { from: sa, to: sb, fromBytes: sum(sa), toBytes: sum(sb) },
  };
}

/** Holdout = cases tagged `holdout` in the suite on disk (the `to` side is normally the checked-out one). */
export async function gateVersions(root: string, from: string, to: string): Promise<VersionsGate> {
  const c = await compareVersions(root, from, to);
  const holdout = (await readSuite(root).catch(() => ({ cases: [] }))).cases
    .filter((x) => x.tags.includes('holdout'))
    .map((x) => x.name);
  return evaluateGate(c.from, c.to, c.cases, c.skillContext, holdout);
}
