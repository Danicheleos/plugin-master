import { useMemo } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useSpaceInvalidate } from '../../api/space';
import { useEvalSuite } from '../evals';
import { listDirIfExists, readFileText, walkFiles } from '../files';
import { useHooks } from '../hooks';
import { buildGraph, type GraphInput } from './buildGraph';

const MAX_TEXTS = 100;
export const graphKey = (spaceId: string) => ['graph', spaceId];
/** Plugin dirs the graph reads (also what the widget watches). */
export const GRAPH_DIRS = [
  'skills',
  'agents',
  'commands',
  'hooks',
  'scripts',
  'bin',
  '.claude-plugin',
];
const RELEVANT = new RegExp(
  `^(${GRAPH_DIRS.map((d) => d.replace('.', '\\.')).join('|')})(/|$)|^(plugin\\.json|\\.mcp\\.json)$`,
);

/** A missing directory or file is "nothing there"; every other failure is an error of the graph. */
const list = listDirIfExists;
const read = readFileText;

function mcpNames(text: string | undefined): string[] {
  try {
    const v: unknown = JSON.parse(text ?? '');
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    const servers =
      o.mcpServers && typeof o.mcpServers === 'object' ? o.mcpServers : o;
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
  const files = [
    ...rootFiles,
    ...(
      await Promise.all(
        dirs.map((d) => walkFiles(spaceId, d, 3, { ifMissing: 'empty' })),
      )
    ).flat(),
  ];
  const allTextPaths = files.filter((f) =>
    /^skills\/[^/]+\/SKILL\.md$|^agents\/[^/]+\.md$/.test(f),
  );
  const textPaths = allTextPaths.slice(0, MAX_TEXTS);
  const texts = Object.fromEntries(
    (
      await Promise.all(
        textPaths.map(async (p) => [p, await read(spaceId, p)] as const),
      )
    ).flatMap(([p, t]) => (t === undefined ? [] : [[p, t] as const])),
  );
  const mcpServers = files.includes('.mcp.json')
    ? mcpNames(await read(spaceId, '.mcp.json'))
    : [];
  return {
    files,
    texts,
    mcpServers,
    skippedTexts: allTextPaths.length - textPaths.length,
  };
}

export const graphQueries = {
  files: (spaceId: string) =>
    queryOptions({
      queryKey: graphKey(spaceId),
      queryFn: () => fetchFiles(spaceId),
    }),
};

/**
 * The structure graph of the space. NOTE: also refetches when a relevant path changes (`fs.changed`).
 * `skippedTexts` = skill/agent files beyond `MAX_TEXTS` that were not read.
 */
export function useGraph(spaceId: string) {
  const files = useQuery(graphQueries.files(spaceId));
  const hooks = useHooks(spaceId);
  const suite = useEvalSuite(spaceId);
  useSpaceInvalidate(
    spaceId,
    (m) => m.type === 'fs.changed' && RELEVANT.test(m.path),
    [graphKey(spaceId)],
  );
  const graph = useMemo(() => {
    if (!files.data) return undefined;
    const { skippedTexts: _skipped, ...rest } = files.data;
    const input: GraphInput = {
      ...rest,
      hooks: hooks.data?.entries ?? [],
      cases: suite.data?.cases ?? [],
    };
    return buildGraph(input);
  }, [files.data, hooks.data, suite.data]);
  return {
    graph,
    error: files.error,
    skippedTexts: files.data?.skippedTexts ?? 0,
  };
}

export { MAX_TEXTS };
