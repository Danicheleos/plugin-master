import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileContentSchema, FileNodeSchema } from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';
import { useSpaceEvents } from '../../api/ws';
import { useEvalSuite } from '../evals/hooks';
import { useHooks } from '../hooks/hooks';
import { buildGraph, type GraphInput } from './buildGraph';

const MAX_TEXTS = 100;
const graphKey = (spaceId: string) => ['graph', spaceId];
/** Plugin dirs the graph reads (also what the widget watches). */
export const GRAPH_DIRS = ['skills', 'agents', 'commands', 'hooks', 'scripts', 'bin', '.claude-plugin'];
const RELEVANT = new RegExp(`^(${GRAPH_DIRS.map((d) => d.replace('.', '\\.')).join('|')})(/|$)|^(plugin\\.json|\\.mcp\\.json)$`);

const list = (spaceId: string, dir: string) =>
  request('GET', `/api/spaces/${spaceId}/tree?dir=${encodeURIComponent(dir)}`, undefined, z.array(FileNodeSchema)).catch(() => []);
const read = (spaceId: string, path: string) =>
  request('GET', `/api/spaces/${spaceId}/file?path=${encodeURIComponent(path)}`, undefined, FileContentSchema).then(
    (f) => f.content,
    () => undefined,
  );

/** Files below `dir` (paths relative to the space), `depth` levels of subdirectories. */
async function walk(spaceId: string, dir: string, depth: number): Promise<string[]> {
  const nodes = await list(spaceId, dir);
  const nested = await Promise.all(
    nodes.map((n) => (n.type === 'file' ? [n.path] : depth > 0 ? walk(spaceId, n.path, depth - 1) : [])),
  );
  return nested.flat();
}

function mcpNames(text: string | undefined): string[] {
  try {
    const v: unknown = JSON.parse(text ?? '');
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    const servers = o.mcpServers && typeof o.mcpServers === 'object' ? o.mcpServers : o;
    return Object.keys(servers as object);
  } catch {
    return [];
  }
}

/** Listing and file texts the graph is derived from: only SKILL.md and agent files are read (at most MAX_TEXTS). */
async function fetchFiles(spaceId: string) {
  const root = await list(spaceId, '');
  const rootFiles = root.filter((n) => n.type === 'file').map((n) => n.path);
  const dirs = GRAPH_DIRS.filter((d) =>
    root.some((n) => n.type === 'dir' && n.name === d),
  );
  const files = [...rootFiles, ...(await Promise.all(dirs.map((d) => walk(spaceId, d, 3)))).flat()];
  const textPaths = files.filter((f) => /^skills\/[^/]+\/SKILL\.md$|^agents\/[^/]+\.md$/.test(f)).slice(0, MAX_TEXTS);
  const texts = Object.fromEntries(
    (await Promise.all(textPaths.map(async (p) => [p, await read(spaceId, p)] as const))).flatMap(([p, t]) =>
      t === undefined ? [] : [[p, t] as const],
    ),
  );
  const mcpServers = files.includes('.mcp.json') ? mcpNames(await read(spaceId, '.mcp.json')) : [];
  return { files, texts, mcpServers };
}

/** The structure graph of the space; refetched when a relevant path changes (fs.changed). */
export function useGraph(spaceId: string) {
  const qc = useQueryClient();
  const files = useQuery({ queryKey: graphKey(spaceId), queryFn: () => fetchFiles(spaceId) });
  const hooks = useHooks(spaceId);
  const suite = useEvalSuite(spaceId);
  useSpaceEvents(spaceId, (msg) => {
    if (msg.type === 'fs.changed' && RELEVANT.test(msg.path)) void qc.invalidateQueries({ queryKey: graphKey(spaceId) });
  });
  const graph = useMemo(() => {
    if (!files.data) return undefined;
    const input: GraphInput = {
      ...files.data,
      hooks: hooks.data?.entries ?? [],
      cases: suite.data?.cases ?? [],
    };
    return buildGraph(input);
  }, [files.data, hooks.data, suite.data]);
  return { graph, error: files.error };
}
