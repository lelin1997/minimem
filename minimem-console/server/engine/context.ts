/**
 * Pipeline 运行上下文管理
 * 管理每次运行中节点之间的数据传递和全局状态
 */

import type { PipelineEdge } from './dag.js';

// ── 类型定义 ──

export interface RunContext {
  /** 运行 ID */
  runId: string;
  /** Pipeline ID */
  pipelineId: string;
  /** Pipeline 名称 */
  pipelineName: string;
  /** 触发方式 */
  trigger: 'manual' | 'cron';
  /** 运行开始时间 */
  startedAt: Date;

  /** Pipeline 全局变量 */
  variables: Record<string, string>;

  /** 全局 LLM 默认配置 */
  defaultLlm: {
    model: string;
    temperature: number;
    max_tokens: number;
  };

  /** 节点输出存储：nodeId → { portId → data } */
  nodeOutputs: Map<string, Record<string, unknown>>;

  /** 节点状态 */
  nodeStatus: Map<string, NodeStatus>;
}

export type NodeStatus = 'pending' | 'running' | 'success' | 'skipped' | 'failed';

// ── 创建上下文 ──

export function createRunContext(params: {
  runId: string;
  pipelineId: string;
  pipelineName: string;
  trigger: 'manual' | 'cron';
  variables: Record<string, string>;
  defaultLlm: { model: string; temperature: number; max_tokens: number };
}): RunContext {
  return {
    runId: params.runId,
    pipelineId: params.pipelineId,
    pipelineName: params.pipelineName,
    trigger: params.trigger,
    startedAt: new Date(),
    variables: { ...params.variables },
    defaultLlm: { ...params.defaultLlm },
    nodeOutputs: new Map(),
    nodeStatus: new Map(),
  };
}

// ── 输出管理 ──

/** 保存节点的输出数据 */
export function setNodeOutput(ctx: RunContext, nodeId: string, portId: string, data: unknown): void {
  if (!ctx.nodeOutputs.has(nodeId)) {
    ctx.nodeOutputs.set(nodeId, {});
  }
  ctx.nodeOutputs.get(nodeId)![portId] = data;
}

/** 获取节点的某个端口输出 */
export function getNodeOutput(ctx: RunContext, nodeId: string, portId: string): unknown {
  return ctx.nodeOutputs.get(nodeId)?.[portId];
}

/** 获取节点的完整输出（所有端口） */
export function getNodeFullOutput(ctx: RunContext, nodeId: string): Record<string, unknown> | undefined {
  return ctx.nodeOutputs.get(nodeId);
}

// ── 输入收集 ──

/**
 * 收集某个节点的输入数据
 * 根据入边，从上游节点的输出中提取数据
 */
export function collectNodeInputs(
  ctx: RunContext,
  nodeId: string,
  inEdges: PipelineEdge[]
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  for (const edge of inEdges) {
    const sourceOutput = getNodeOutput(ctx, edge.source_node, edge.source_port);
    let data = sourceOutput;

    // 如果 edge 有 transform 表达式，应用简单的 JSONPath 提取
    if (edge.transform) {
      data = applyTransform(sourceOutput, edge.transform);
    }

    inputs[edge.target_port] = data;
  }

  return inputs;
}

// ── 内置变量 ──

/** 获取所有内置变量 */
export function getBuiltinVariables(ctx: RunContext): Record<string, string> {
  const now = ctx.startedAt;

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return {
    $date: dateStr,
    $time: timeStr,
    $datetime: `${dateStr} ${timeStr}`,
    $run_id: ctx.runId,
    $trigger: ctx.trigger,
    $pipeline_name: ctx.pipelineName,
  };
}

// ── 模板数据 ──

/** 构建用于模板渲染的完整数据对象 */
export function buildTemplateData(ctx: RunContext, currentNodeId?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // 内置变量（以 $ 开头）
  const builtins = getBuiltinVariables(ctx);
  Object.assign(data, builtins);

  // Pipeline 全局变量
  data.vars = { ...ctx.variables };

  // 所有节点输出
  const nodes: Record<string, unknown> = {};
  for (const [nodeId, output] of ctx.nodeOutputs.entries()) {
    // 如果只有一个端口 "out"，简化访问
    if (output.out !== undefined && Object.keys(output).length === 1) {
      nodes[nodeId] = { output: output.out };
    } else {
      nodes[nodeId] = { output };
    }
  }
  data.nodes = nodes;

  // 快捷访问：直接 {{nodeId}} 取 output
  for (const [nodeId, output] of ctx.nodeOutputs.entries()) {
    if (output.out !== undefined && Object.keys(output).length === 1) {
      data[nodeId] = output.out;
    } else {
      data[nodeId] = output;
    }
  }

  return data;
}

// ── 工具函数 ──

/** 简单的属性路径提取（支持 $.field.subfield 格式） */
function applyTransform(data: unknown, transform: string): unknown {
  if (!transform || !data) return data;

  // 去掉 $. 前缀
  let path = transform;
  if (path.startsWith('$.')) {
    path = path.slice(2);
  } else if (path.startsWith('$')) {
    path = path.slice(1);
  }

  const parts = path.split('.');
  let current: any = data;

  for (const part of parts) {
    if (current == null) return undefined;

    // 处理数组索引 [*] 或 [0]
    const arrayMatch = part.match(/^(\w+)\[(\*|\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]];
      if (Array.isArray(current)) {
        if (arrayMatch[2] === '*') {
          // 保持数组
        } else {
          current = current[parseInt(arrayMatch[2], 10)];
        }
      }
    } else {
      current = current[part];
    }
  }

  return current;
}
