/**
 * output-file 执行器
 * 将内容写入本地文件
 */

import fs from 'fs';
import path from 'path';
import type { NodeExecutor, ExecutorResult } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getConfig } from '../config.js';

export const outputFileExecutor: NodeExecutor = async (node, inputs, ctx, templateData) => {
  const cfg = node.config as Record<string, any>;
  const config = getConfig();

  // 渲染路径模板
  const pathTemplate = renderTemplate(String(cfg.path_template || ''), templateData);
  if (!pathTemplate) {
    throw new Error('output-file 节点缺少必填参数 path_template');
  }

  const format = cfg.format || 'md';
  const content = inputs.in;

  // 转换内容为字符串
  let contentStr: string;
  if (typeof content === 'string') {
    contentStr = content;
  } else if (format === 'json') {
    contentStr = JSON.stringify(content, null, 2);
  } else if (format === 'csv' && Array.isArray(content)) {
    contentStr = arrayToCSV(content);
  } else {
    contentStr = String(content ?? '');
  }

  // 构建完整文件路径
  const outputDir = config.pipeline.output_dir;
  const fullPath = path.isAbsolute(pathTemplate)
    ? pathTemplate
    : path.join(outputDir, pathTemplate);

  // 确保目录存在
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  // 写入文件
  fs.writeFileSync(fullPath, contentStr, 'utf-8');

  return {
    outputs: {
      out: {
        path: fullPath,
        size: Buffer.byteLength(contentStr, 'utf-8'),
        format,
      },
    },
  };
};

function arrayToCSV(items: any[]): string {
  if (items.length === 0) return '';

  const first = items[0];
  const keys = typeof first === 'object' && first !== null ? Object.keys(first) : ['value'];

  const header = keys.join(',');
  const rows = items.map((item) => {
    if (typeof item === 'object' && item !== null) {
      return keys.map((k) => escapeCSV(String(item[k] ?? ''))).join(',');
    }
    return escapeCSV(String(item));
  });

  return [header, ...rows].join('\n');
}

function escapeCSV(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
