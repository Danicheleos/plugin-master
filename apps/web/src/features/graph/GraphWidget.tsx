import { lazy, Suspense, useEffect } from 'react';
import { Loader, Text } from '@mantine/core';
import { GRAPH_DIRS, useGraph } from './hooks';
import styles from './graph.module.scss';

const GraphView = lazy(() => import('./GraphView'));

type Props = { spaceId: string; onOpenFile: (path: string) => void; onWatch?: (paths: string[]) => void };

/** Plugin structure graph: manifest, skills, agents, commands, hooks, scripts, MCP servers and eval cases. */
export function GraphWidget({ spaceId, onOpenFile, onWatch }: Props) {
  const { graph, error } = useGraph(spaceId);
  // non-recursive server watch: the plugin dirs, each skill dir and the md files that are read
  const watch = JSON.stringify(
    graph
      ? [...GRAPH_DIRS, ...graph.nodes.flatMap((n) => (n.file && /^(skills|agents)\//.test(n.file) ? [n.file.replace(/[^/]*$/, '').slice(0, -1), n.file] : []))]
      : [],
  );
  useEffect(() => onWatch?.(JSON.parse(watch) as string[]), [watch, onWatch]);

  if (error) return <Text c="red" p="md">{error.message}</Text>;
  if (!graph) return <Loader m="md" size="sm" />;
  if (!graph.nodes.length) return <Text c="dimmed" p="md">Nothing to show: no plugin.json, skills, agents, commands, hooks or eval cases.</Text>;
  return (
    <div className={styles.root}>
      <Suspense fallback={<Loader m="md" size="sm" />}>
        <GraphView nodes={graph.nodes} edges={graph.edges} onOpen={onOpenFile} />
      </Suspense>
    </div>
  );
}
