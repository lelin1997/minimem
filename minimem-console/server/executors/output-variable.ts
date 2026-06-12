/**
 * output-variable 执行器
 * 将输出存为 Pipeline 变量，供后续运行引用
 */

import type { NodeExecutor } from './index.js';
import { getPipeline, updatePipeline } from '../store/pipelines.js';

export const outputVariableExecutor: NodeExecutor = async (node, inputs, ctx, _templateData) => {
  const cfg = node.config as Record<string, any>;
  const variableName = String(cfg.variable_name || '');

  if (!variableName) {
    throw new Error('output-variable 节点缺少必填参数 variable_name');
  }

  const value = inputs.in;
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

  // 获取现有变量，合并后更新
  const pipeline = getPipeline(ctx.pipelineId);
  const existingVars = pipeline?.variables || {};

  updatePipeline(ctx.pipelineId, {
    variables: { ...existingVars, [variableName]: valueStr },
  });

  return {
    outputs: {
      out: {
        variable: variableName,
        value: valueStr,
        saved: true,
      },
    },
  };
};
