import { posix } from 'node:path';
import { z } from 'zod';

/**
 * Retrieval metrics of a run from its trace: the files the final answer names, scored against a case's
 * `truth.json` (`relevant` must be named, `allowed` may be). A `relevant` item ending in `/` is a directory item,
 * hit by that directory or by a file directly inside it.
 */
export const TruthSchema = z.object({
  relevant: z.array(z.string()),
  allowed: z.array(z.string()).default([]),
  /** Where the answer lists its files: a ```files block, a `## Files` section or `path:line` citations. */
  source: z.enum(['files-block', 'files-section', 'citations']).default('files-block'),
  /** Regexes of answer paths dropped before scoring (neither hit nor extra); default: companion files (styles, templates, tests, mocks, stories). */
  ignore: z.array(z.string()).default(['\\.(s?css|less|sass|html?)$', '\\.(spec|test|stories|mocks?)\\.[^/]+$', '(^|/)__mocks__/']),
});
export type Truth = z.infer<typeof TruthSchema>;
export type Retrieval = { recall: number | null; precision: number | null; f1: number | null };

/** The main session's last text of a stream-json trace: the answer the user reads. */
export function finalText(trace: string): string {
  let last = '';
  for (const line of trace.split('\n')) {
    let e: { type?: string; parent_tool_use_id?: string | null; message?: { content?: unknown } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== 'assistant' || e.parent_tool_use_id || !Array.isArray(e.message?.content)) continue;
    const text = (e.message.content as { type?: string; text?: string }[])
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n')
      .trim();
    if (text) last = text;
  }
  return last;
}

const PATH = /(?:^|[\s`*([])((?:\/|\.\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]+)(:\d+(?:[-–]\d+)?)?/g;

/** Repository-relative: drops `./`, a leading `repo/` and anything up to `/repo/`. */
function normalize(file: string): string {
  let out = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const at = out.lastIndexOf('/repo/');
  if (at >= 0) out = out.slice(at + '/repo/'.length);
  else if (out.startsWith('repo/')) out = out.slice('repo/'.length);
  return posix.normalize(out);
}

/** Paths the answer names; null when its list is missing (the run broke the contract). */
export function foundPaths(text: string, source: Truth['source']): string[] | null {
  let body = text;
  if (source === 'files-section') {
    const lines = text.split('\n');
    const start = lines.map((l) => /^#{1,6}\s*files\s*:?\s*$/i.test(l.trim())).lastIndexOf(true);
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l.trim()));
    body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
  }
  if (source === 'files-block') {
    const block = /```files[ \t]*\r?\n([\s\S]*?)```/.exec(text);
    if (!block) return null;
    body = block[1] ?? '';
  }
  const found = new Set<string>();
  if (source === 'files-block') {
    // A line naming a directory (trailing `/`, or a bare extensionless path) keeps one trailing `/`.
    const rest: string[] = [];
    for (const line of body.split('\n')) {
      const entry = line.trim().replace(/^[-*]\s+/, '').replace(/^`|`$/g, '');
      if (/^(?:\.\/)?[\w@.-]+(?:\/[\w@.-]+)*\/$/.test(entry) || /^(?:\.\/)?[\w@-]+(?:\/[\w@-]+)+$/.test(entry))
        found.add(`${normalize(entry).replace(/\/$/, '')}/`);
      else rest.push(line);
    }
    body = rest.join('\n');
  }
  for (const m of body.matchAll(PATH)) {
    if (source === 'citations' && m[2] === undefined) continue;
    found.add(normalize(m[1] as string));
  }
  return [...found].sort();
}

const ratio = (a: number, b: number) => (b === 0 ? null : Number((a / b).toFixed(3)));

/** Recall, precision and F1 (null where undefined); a missing list scores recall and F1 0. */
export function scoreFiles(truth: Truth, all: string[] | null): Retrieval {
  if (!all) return { recall: 0, precision: null, f1: 0 };
  const ignore = truth.ignore.flatMap((p) => {
    try {
      return [new RegExp(p, 'i')];
    } catch {
      return [];
    }
  });
  const found = all.filter((f) => !ignore.some((re) => re.test(f)));
  const relevant = new Set(truth.relevant);
  const allowed = new Set(truth.allowed);
  const dirOf = (f: string) => `${posix.dirname(f)}/`;
  const dirItems = new Set(truth.relevant.filter((i) => i.endsWith('/')));
  const fileDirs = new Set(truth.relevant.filter((i) => !i.endsWith('/')).map(dirOf));
  const isNamed = (i: string) =>
    found.includes(i) || (dirItems.has(i) && found.some((f) => !f.endsWith('/') && dirOf(f) === i));
  const hits = truth.relevant.filter(isNamed).length;
  const extra = found.filter((f) =>
    f.endsWith('/')
      ? !dirItems.has(f) && !fileDirs.has(f)
      : !relevant.has(f) && !allowed.has(f) && !dirItems.has(dirOf(f)),
  ).length;
  const recall = ratio(hits, relevant.size);
  const precision = ratio(found.length - extra, found.length);
  const f1 =
    recall === null || precision === null || recall + precision === 0
      ? recall === 0 || precision === 0
        ? 0
        : null
      : Number(((2 * recall * precision) / (recall + precision)).toFixed(3));
  return { recall, precision, f1 };
}

export const retrievalOf = (truth: Truth, trace: string): Retrieval =>
  scoreFiles(truth, foundPaths(finalText(trace), truth.source));
