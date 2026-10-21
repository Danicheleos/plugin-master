import { useMemo } from 'react';
import { Background, Controls, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutGraph, type GraphEdge, type GraphNode } from './buildGraph';
import styles from './graph.module.scss';

type Props = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  onOpen: (path: string) => void;
};

/** The xyflow canvas; lazy-loaded by `GraphWidget` so the library stays out of the main bundle. */
export default function GraphView({ nodes, edges, onOpen }: Props) {
  const flowNodes = useMemo<Node[]>(() => {
    const pos = layoutGraph(nodes);
    return nodes.map((n) => ({
      id: n.id,
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: { label: n.label, file: n.file },
      className: `${styles.node} ${styles[n.kind]} ${n.file ? styles.clickable : ''}`,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));
  }, [nodes]);
  const flowEdges = useMemo<Edge[]>(() => edges.map((e) => ({ ...e })), [edges]);
  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      minZoom={0.2}
      onNodeClick={(_, n) => {
        const file = (n.data as { file?: string }).file;
        if (file) onOpen(file);
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
