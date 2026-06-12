/**
 * DAG 构建 + 拓扑排序
 * 将 Pipeline 的 nodes + edges 解析为有向无环图，输出按层级分组的执行顺序
 */

// ── 类型定义 ──

export interface PipelineNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  inputs: PortDef[];
  outputs: PortDef[];
}

export interface PortDef {
  id: string;
  label: string;
  type: 'any' | 'text' | 'json' | 'memories' | 'boolean' | 'number';
}

export interface PipelineEdge {
  id: string;
  source_node: string;
  source_port: string;
  target_node: string;
  target_port: string;
  transform?: string;
}

export interface DAGLayer {
  level: number;
  nodeIds: string[];
}

export interface DAGResult {
  layers: DAGLayer[];
  nodeMap: Map<string, PipelineNode>;
  /** 每个节点的入边映射：nodeId → 该节点的所有入边 */
  inEdges: Map<string, PipelineEdge[]>;
  /** 每个节点的出边映射：nodeId → 该节点的所有出边 */
  outEdges: Map<string, PipelineEdge[]>;
}

// ── DAG 构建 ──

export function buildDAG(nodes: PipelineNode[], edges: PipelineEdge[]): DAGResult {
  // 构建节点映射
  const nodeMap = new Map<string, PipelineNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // 构建邻接关系
  const inEdges = new Map<string, PipelineEdge[]>();
  const outEdges = new Map<string, PipelineEdge[]>();
  const inDegree = new Map<string, number>();

  // 初始化所有节点
  for (const node of nodes) {
    inEdges.set(node.id, []);
    outEdges.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  // 填充边关系
  for (const edge of edges) {
    if (!nodeMap.has(edge.source_node) || !nodeMap.has(edge.target_node)) {
      continue; // 忽略引用不存在节点的边
    }
    outEdges.get(edge.source_node)!.push(edge);
    inEdges.get(edge.target_node)!.push(edge);
    inDegree.set(edge.target_node, (inDegree.get(edge.target_node) || 0) + 1);
  }

  // ── Kahn 拓扑排序（按层级分组）──
  const layers: DAGLayer[] = [];
  let currentLevel: string[] = [];

  // 找到所有入度为 0 的节点（数据源节点）
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      currentLevel.push(nodeId);
    }
  }

  let processedCount = 0;
  let level = 0;

  while (currentLevel.length > 0) {
    layers.push({ level, nodeIds: [...currentLevel] });
    processedCount += currentLevel.length;

    const nextLevel: string[] = [];

    for (const nodeId of currentLevel) {
      const outs = outEdges.get(nodeId) || [];
      for (const edge of outs) {
        const targetDegree = (inDegree.get(edge.target_node) || 1) - 1;
        inDegree.set(edge.target_node, targetDegree);
        if (targetDegree === 0) {
          nextLevel.push(edge.target_node);
        }
      }
    }

    currentLevel = nextLevel;
    level++;
  }

  // 检测环
  if (processedCount !== nodes.length) {
    const remainingNodes = nodes
      .filter((n) => (inDegree.get(n.id) || 0) > 0)
      .map((n) => n.label || n.id);
    throw new DAGCycleError(
      `Pipeline 包含循环依赖，无法执行。涉及节点：${remainingNodes.join(', ')}`
    );
  }

  return { layers, nodeMap, inEdges, outEdges };
}

// ── 异常 ──

export class DAGCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DAGCycleError';
  }
}

// ── 工具函数 ──

/** 获取节点的所有上游节点 ID */
export function getUpstreamNodes(nodeId: string, dag: DAGResult): string[] {
  const edges = dag.inEdges.get(nodeId) || [];
  return edges.map((e) => e.source_node);
}

/** 获取节点的所有下游节点 ID */
export function getDownstreamNodes(nodeId: string, dag: DAGResult): string[] {
  const edges = dag.outEdges.get(nodeId) || [];
  return edges.map((e) => e.target_node);
}

/** 验证 DAG 是否合法（不含环、所有引用的节点存在） */
export function validateDAG(nodes: PipelineNode[], edges: PipelineEdge[]): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const edge of edges) {
    if (!nodeIds.has(edge.source_node)) {
      errors.push(`Edge ${edge.id} 的源节点 ${edge.source_node} 不存在`);
    }
    if (!nodeIds.has(edge.target_node)) {
      errors.push(`Edge ${edge.id} 的目标节点 ${edge.target_node} 不存在`);
    }
    if (edge.source_node === edge.target_node) {
      errors.push(`Edge ${edge.id} 是自环（源和目标相同）`);
    }
  }

  // 检测环
  try {
    buildDAG(nodes, edges);
  } catch (err) {
    if (err instanceof DAGCycleError) {
      errors.push(err.message);
    }
  }

  return errors;
}
