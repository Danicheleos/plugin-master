import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMap, parseDocument } from 'yaml';
import {
  HOOK_EVENTS, readHooks, validateGroup, writeHooks,
  type Group, type HookEntry, type HookSource, type HookSourceRow, type HooksResponse, type PutHooks,
} from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import { withLock } from '../spaces/config-file';

const MAX_FILES = 200;
const CANONICAL = {
  plugin: 'hooks/hooks.json',
  project: '.claude/settings.json',
  local: '.claude/settings.local.json',
} as const;

type Target = { source: HookSource; file: string; md: boolean };
type Config = Record<string, unknown>;

const norm = (p: string) => path.posix.normalize(p.replace(/^\.\//, ''));
const isObject = (v: unknown): v is Config => typeof v === 'object' && v !== null && !Array.isArray(v);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Leading `---` block of a Markdown file (a sticky match at 0), or null. */
export function splitFrontmatter(text: string) {
  const re = /(---[ \t]*\r?\n)([\s\S]*?)^(---[ \t]*(?:\r?\n|$))/my;
  const m = re.exec(text);
  return m && { open: m[1], inner: m[2], close: m[3], end: m[0].length };
}

/** Files named by `.claude-plugin/plugin.json` `hooks` (a path or an array of paths; inline objects are not editable here). */
async function manifestHookFiles(root: string): Promise<string[]> {
  try {
    const m = JSON.parse(await readFile(resolveInSpace(root, '.claude-plugin/plugin.json'), 'utf8')) as { hooks?: unknown };
    const list = Array.isArray(m.hooks) ? m.hooks : [m.hooks];
    return list.filter((p): p is string => typeof p === 'string' && p !== '').map(norm);
  } catch {
    return [];
  }
}

async function listNames(root: string, dir: string, only: 'dir' | 'file') {
  try {
    const items = await readdir(resolveInSpace(root, dir), { withFileTypes: true });
    return items
      .filter((d) => (only === 'dir' ? !d.isFile() : !d.isDirectory()))
      .map((d) => d.name)
      .sort()
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

/** Existence of a file inside the space; escaping paths come back as `error`. */
async function probe(root: string, file: string): Promise<{ abs?: string; exists: boolean; error?: string }> {
  try {
    const abs = resolveInSpace(root, file);
    return { abs, exists: await stat(abs).then((s) => s.isFile(), () => false) };
  } catch (e) {
    return { exists: false, error: message(e) };
  }
}

async function discover(root: string): Promise<Target[]> {
  const t = (source: HookSource, file: string, md = false): Target => ({ source, file, md });
  const out = [t('plugin', CANONICAL.plugin)];
  for (const f of await manifestHookFiles(root)) if (f !== CANONICAL.plugin) out.push(t('plugin', f));
  out.push(t('project', CANONICAL.project), t('local', CANONICAL.local));
  const skills: Target[] = [];
  for (const n of await listNames(root, 'skills', 'dir')) {
    const file = `skills/${n}/SKILL.md`;
    const p = await probe(root, file);
    if (p.exists || p.error) skills.push(t('skill', file, true));
  }
  const agents = (await listNames(root, 'agents', 'file')).filter((n) => n.endsWith('.md'));
  return [...out, ...skills, ...agents.map((n) => t('agent', `agents/${n}`, true))];
}

function parseConfig(t: Target, text: string): Config {
  if (t.md) {
    const fm = splitFrontmatter(text);
    if (!fm) return {};
    const doc = parseDocument(fm.inner);
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    const cfg = doc.toJS() ?? {};
    if (!isObject(cfg)) throw new Error('Frontmatter must be a mapping');
    return cfg;
  }
  const cfg: unknown = text.trim() ? JSON.parse(text) : {};
  if (!isObject(cfg)) throw new Error('Must be a JSON object');
  return cfg;
}

async function load(root: string, t: Target): Promise<{ row: HookSourceRow; entries: HookEntry[] }> {
  const p = await probe(root, t.file);
  const row: HookSourceRow = { source: t.source, file: t.file, exists: p.exists };
  if (p.error) return { row: { ...row, error: p.error }, entries: [] };
  if (!p.abs || !p.exists) return { row, entries: [] };
  try {
    const config = parseConfig(t, await readFile(p.abs, 'utf8'));
    return { row, entries: readHooks(t.source, t.file, config) };
  } catch (e) {
    return { row: { ...row, error: message(e) }, entries: [] };
  }
}

export async function listHooks(root: string): Promise<HooksResponse> {
  const loaded = await Promise.all((await discover(root)).map((t) => load(root, t)));
  return {
    events: [...HOOK_EVENTS],
    sources: loaded.map((l) => l.row),
    entries: loaded.flatMap((l) => l.entries),
  };
}

/** New file text, or null when nothing needs writing. Other keys, comments and the body are kept. */
function render(t: Target, text: string | undefined, event: string, groups: Group[]): string | null {
  if (text === undefined && groups.length === 0) return null;
  if (!t.md) {
    const next = writeHooks(parseConfig(t, text ?? ''), event, groups);
    const indent = /^[ \t]+(?=")/m.exec(text ?? '')?.[0] ?? '  ';
    const eol = text === undefined || text.endsWith('\n') ? '\n' : '';
    return JSON.stringify(next, null, indent) + eol;
  }
  const src = text ?? '';
  const fm = splitFrontmatter(src);
  const doc = parseDocument(fm?.inner ?? '');
  const next = writeHooks(parseConfig(t, src), event, groups) as { hooks?: unknown };
  if (next.hooks === undefined) doc.delete('hooks');
  else doc.set('hooks', next.hooks);
  const empty = isMap(doc.contents) && doc.contents.items.length === 0;
  let yaml = doc.contents == null ? (fm?.inner ?? '') : empty ? '' : doc.toString({ lineWidth: 0 });
  if (fm?.open.includes('\r\n')) yaml = yaml.replace(/\r?\n/g, '\r\n');
  if (!fm) return yaml ? `---\n${yaml}---\n${src}` : null;
  return fm.open + yaml + fm.close + src.slice(fm.end);
}

async function writeAtomic(abs: string, data: string) {
  const target = await realpath(abs).catch(() => abs);
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(tmp, data);
    const mode = await stat(target).then((s) => s.mode & 0o777, () => undefined);
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Replaces `hooks[event]` in one source file (empty `groups` clears it) and returns the fresh listing. */
export async function putHooks(root: string, input: PutHooks): Promise<HooksResponse> {
  const file = norm(input.file);
  const target = (await discover(root)).find((t) => t.source === input.source && t.file === file);
  if (!target) throw new AppError('HOOKS_FILE_INVALID', `"${input.file}" is not a ${input.source} hooks file`, 400);
  const problems = input.groups.flatMap((g, i) =>
    validateGroup(input.source, input.event, g).map((p) => `groups[${i}]${p.path ? '.' + p.path : ''}: ${p.message}`),
  );
  if (problems.length) throw new AppError('HOOKS_INVALID', problems.join('\n'), 422);
  const abs = resolveInSpace(root, file);
  await withLock(abs, async () => {
    const text = await readFile(abs, 'utf8').catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    });
    let out: string | null;
    try {
      out = render(target, text, input.event, input.groups as Group[]);
    } catch (e) {
      throw new AppError('HOOKS_FILE_BROKEN', `${file} is not valid: ${message(e)}`, 422);
    }
    if (out !== null) await writeAtomic(abs, out);
  });
  return listHooks(root);
}
