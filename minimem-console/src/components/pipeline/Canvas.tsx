import { useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { PipelineNode, PipelineEdge, NodeType } from '@/api/pipeline';
import { CustomNode } from './CustomNode';

interface CanvasProps {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  nodeTypes: NodeType[];
  selectedNodeId: string | null;
  onNodesChange: (nodes: PipelineNode[]) => void;
  onEdgesChange: (edges: PipelineEdge[]) => void;
  onSelectNode: (nodeId: string | null) => void;
  onDropNode: (type: string, position: { x: number; y: number }) => void;
}

// 将我们的数据模型转换为 React Flow 格式
function toFlowNodes(nodes: PipelineNode[], nodeTypes: NodeType[], selectedId: string | null): Node[] {
  return nodes.map((n) => {
    const nt = nodeTypes.find((t) => t.type === n.type);
    return {
      id: n.id,
      type: 'custom',
      position: n.position,
      selected: n.id === selectedId,
      data: {
        label: n.label,
        nodeType: n.type,
        category: nt?.category || 'source',
        color: nt?.color || '#6B7280',
        icon: nt?.icon || 'box',
        inputs: n.inputs,
        outputs: n.outputs,
        config: n.config,
      },
    };
  });
}

function toFlowEdges(edges: PipelineEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source_node,
    sourceHandle: e.source_port,
    target: e.target_node,
    targetHandle: e.target_port,
    animated: false,
    style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.5 },
  }));
}

const rfNodeTypes = { custom: CustomNode };

export function Canvas({
  nodes,
  edges,
  nodeTypes,
  selectedNodeId,
  onNodesChange,
  onEdgesChange,
  onSelectNode,
  onDropNode,
}: CanvasProps) {
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const flowNodes = useMemo(
    () => toFlowNodes(nodes, nodeTypes, selectedNodeId),
    [nodes, nodeTypes, selectedNodeId],
  );
  const flowEdges = useMemo(() => toFlowEdges(edges), [edges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 过滤出需要关注的变更类型（position / remove）
      const positionChanges = changes.filter(
        (c) => c.type === 'position' && c.position,
      );
      const deleteChanges = changes.filter((c) => c.type === 'remove');

      // 如果只有 dimensions / select 等非关键变更，不要更新业务数据
      if (positionChanges.length === 0 && deleteChanges.length === 0) {
        return;
      }

      let newNodes = nodes;

      // 应用位置变更
      if (positionChanges.length > 0) {
        const posMap = new Map<string, { x: number; y: number }>();
        for (const c of positionChanges) {
          if (c.type === 'position' && c.position) {
            posMap.set(c.id, c.position);
          }
        }
        newNodes = newNodes.map((n) => {
          const newPos = posMap.get(n.id);
          if (newPos && (newPos.x !== n.position.x || newPos.y !== n.position.y)) {
            return { ...n, position: newPos };
          }
          return n;
        });
      }

      // 应用删除变更
      if (deleteChanges.length > 0) {
        const deletedIds = new Set(deleteChanges.map((c) => c.id));
        newNodes = newNodes.filter((n) => !deletedIds.has(n.id));
      }

      // 只有真正有变化时才通知上层
      if (newNodes !== nodes) {
        onNodesChange(newNodes);
      }
    },
    [nodes, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // 只关注 remove 类型的变更，忽略 select 等非关键变更
      const removeChanges = changes.filter((c) => c.type === 'remove');
      if (removeChanges.length === 0) return;

      const removedIds = new Set(removeChanges.map((c) => c.id));
      const newEdges = edges.filter((e) => !removedIds.has(e.id));
      if (newEdges.length !== edges.length) {
        onEdgesChange(newEdges);
      }
    },
    [edges, onEdgesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const newEdge: PipelineEdge = {
        id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source_node: connection.source!,
        source_port: connection.sourceHandle || 'out',
        target_node: connection.target!,
        target_port: connection.targetHandle || 'in',
      };
      onEdgesChange([...edges, newEdge]);
    },
    [edges, onEdgesChange],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  // 拖放支持
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/pipeline-node-type');
      if (!type || !rfRef.current) return;

      const position = rfRef.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      onDropNode(type, position);
    },
    [onDropNode],
  );

  return (
    <div className="h-full w-full" onDragOver={handleDragOver} onDrop={handleDrop}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={rfNodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onInit={(instance) => { rfRef.current = instance; }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        snapToGrid={false}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionLineStyle={{ stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
        defaultEdgeOptions={{
          style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.5 },
        }}
        proOptions={{ hideAttribution: true }}
        panOnDrag
        selectionOnDrag={false}
        nodeDragThreshold={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--border))" />
        <Controls
          showInteractive={false}
          className="!rounded-xl !border !border-border/60 !bg-card !shadow-apple [&>button]:!border-border/40 [&>button]:!bg-card [&>button]:!text-muted-foreground [&>button:hover]:!bg-muted"
        />
        <MiniMap
          className="!rounded-xl !border !border-border/60 !bg-card/80 !shadow-apple"
          maskColor="rgba(0,0,0,0.05)"
          nodeColor={(n) => n.data?.color || '#6B7280'}
          nodeStrokeWidth={0}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
