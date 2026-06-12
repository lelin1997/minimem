/**
 * error-handler 执行器
 * 错误处理节点：提供两个输入端口 —— data（正常数据）和 error（错误信息）
 * 如果 data 有值则透传，如果 data 为空但 error 有值则输出兜底值
 * 用于在 Pipeline 中实现 try-catch 式的错误恢复
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';

export const errorHandlerExecutor: NodeExecutor = async (node, inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const fallbackTemplate = String(cfg.fallback_value || '');
  const logError = cfg.log_error !== false; // 默认打印错误日志

  const data = inputs.data;
  const error = inputs.error;

  // 判断 data 端口是否有有效数据
  const hasData = data !== undefined && data !== null;

  if (hasData) {
    // 正常路径：透传数据
    return {
      outputs: {
        out: data,
        had_error: false,
      },
    };
  }

  // 错误路径：使用兜底值
  if (logError && error) {
    console.warn(
      `[error-handler] 节点 ${node.label || node.id} 捕获错误:`,
      typeof error === 'string' ? error : JSON.stringify(error)
    );
  }

  let fallback: unknown = null;
  if (fallbackTemplate) {
    try {
      const rendered = renderTemplate(fallbackTemplate, {
        ...templateData,
        error: typeof error === 'string' ? error : JSON.stringify(error),
      });
      // 尝试解析为 JSON
      try {
        fallback = JSON.parse(rendered);
      } catch {
        fallback = rendered;
      }
    } catch {
      fallback = fallbackTemplate;
    }
  }

  return {
    outputs: {
      out: fallback,
      had_error: true,
      error_detail: typeof error === 'string' ? error : JSON.stringify(error ?? 'unknown'),
    },
  };
};
