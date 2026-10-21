import { readdir, readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { EvalSuite, EvalSuiteCase } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { evalDir } from './eval-dir';

const MAX_DEPTH = 6;
const SKIP = new Set(['results', 'mocks', 'traces', 'graders', 'node_modules']);

const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** YAML between the leading `---` lines of a Markdown file; `{}` when absent. */
function frontmatter(src: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
  return m ? asObject(parse(m[1])) : {};
}

async function readOptional(root: string, rel: string) {
  return readFile(resolveInSpace(root, rel), 'utf8').catch(() => undefined);
}

/** `tool_used` graders of `case.yaml` (`graders:`) and `graders/*.md` frontmatter. */
function toolGraders(yamlGraders: unknown, extra: Record<string, unknown>[]) {
  const list = [...(Array.isArray(yamlGraders) ? yamlGraders.map(asObject) : []), ...extra];
  return list.flatMap((g) =>
    g.type === 'tool_used' && text(g.tool)
      ? [{ tool: text(g.tool) as string, ...(text(g.input_match) && { inputMatch: text(g.input_match) }) }]
      : [],
  );
}

async function graderFiles(root: string, dir: string) {
  const names = await readdir(resolveInSpace(root, `${dir}/graders`)).catch(() => []);
  const out: Record<string, unknown>[] = [];
  for (const n of names.filter((x) => x.endsWith('.md')).sort()) {
    const src = await readOptional(root, `${dir}/graders/${n}`);
    try {
      if (src) out.push(frontmatter(src));
    } catch {
      // unparsable grader: ignored
    }
  }
  return out;
}

/** `prompt.md` frontmatter overrides `case.yaml`, as in the CLI. */
async function readCase(
  root: string,
  dir: string,
  fallbackName: string,
): Promise<EvalSuiteCase> {
  try {
    const yaml = await readOptional(root, `${dir}/case.yaml`);
    const md = await readOptional(root, `${dir}/prompt.md`);
    const meta = {
      ...asObject(yaml && parse(yaml)),
      ...(md ? frontmatter(md) : {}),
    };
    const tags = Array.isArray(meta.tags)
      ? meta.tags.filter((t): t is string => typeof t === 'string')
      : [];
    const tg = toolGraders(meta.graders, await graderFiles(root, dir));
    return {
      name: text(meta.name) ?? fallbackName,
      dir,
      tags,
      ...(tg.length && { toolGraders: tg }),
      ...(text(meta.description) && { description: text(meta.description) }),
    };
  } catch (e) {
    return {
      name: fallbackName,
      dir,
      tags: [],
      error: e instanceof Error ? e.message.split('\n')[0] : String(e),
    };
  }
}

/** A case is a directory with `prompt.md` or `case.yaml`; other directories are searched for cases. */
async function walk(
  root: string,
  dir: string,
  depth: number,
  out: EvalSuiteCase[],
): Promise<void> {
  const entries = await readdir(resolveInSpace(root, dir), {
    withFileTypes: true,
  }).catch(() => []);
  if (entries.some((e) => e.isFile() && /^(prompt\.md|case\.yaml)$/.test(e.name))) {
    out.push(await readCase(root, dir, dir.split('/').pop() ?? dir));
    return;
  }
  if (depth >= MAX_DEPTH) return;
  const subdirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of subdirs) await walk(root, `${dir}/${name}`, depth + 1, out);
}

export async function readSuite(root: string): Promise<EvalSuite> {
  const cases: EvalSuiteCase[] = [];
  await walk(root, await evalDir(root), 0, cases);
  const tags = [...new Set(cases.flatMap((c) => c.tags))].sort();
  return { cases, tags };
}
