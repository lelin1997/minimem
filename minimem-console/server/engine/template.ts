/**
 * Handlebars 模板引擎 + 内置 helpers
 * 支持：节点输出引用、全局变量、内置变量、日期计算
 */

import Handlebars from 'handlebars';

// ── 注册内置 Helpers ──

// JSON 美化
Handlebars.registerHelper('json_pretty', (data: unknown) => {
  try {
    return new Handlebars.SafeString(JSON.stringify(data, null, 2));
  } catch {
    return String(data);
  }
});

// JSON 紧凑格式
Handlebars.registerHelper('json', (data: unknown) => {
  try {
    return new Handlebars.SafeString(JSON.stringify(data));
  } catch {
    return String(data);
  }
});

// 文本截断
Handlebars.registerHelper('truncate', (text: unknown, length: number) => {
  const str = String(text || '');
  if (str.length <= length) return str;
  return str.slice(0, length) + '…';
});

// 数组拼接
Handlebars.registerHelper('join', (items: unknown[], separator: string) => {
  if (!Array.isArray(items)) return '';
  return items.join(typeof separator === 'string' ? separator : ', ');
});

// 日期格式化（简化版）
Handlebars.registerHelper('date_format', (dateStr: string, format: string) => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;

    const pad = (n: number) => String(n).padStart(2, '0');
    const f = typeof format === 'string' ? format : 'YYYY-MM-DD';

    return f
      .replace('YYYY', String(d.getFullYear()))
      .replace('MM', pad(d.getMonth() + 1))
      .replace('DD', pad(d.getDate()))
      .replace('HH', pad(d.getHours()))
      .replace('mm', pad(d.getMinutes()))
      .replace('ss', pad(d.getSeconds()));
  } catch {
    return dateStr;
  }
});

// 日期偏移计算
Handlebars.registerHelper('$date_offset', (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + (typeof days === 'number' ? days : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
});

// 数组转 Markdown 表格
Handlebars.registerHelper('markdown_table', (items: unknown[]) => {
  if (!Array.isArray(items) || items.length === 0) return '';

  const first = items[0] as Record<string, unknown>;
  const keys = Object.keys(first);

  let table = `| ${keys.join(' | ')} |\n`;
  table += `| ${keys.map(() => '---').join(' | ')} |\n`;

  for (const item of items) {
    const row = item as Record<string, unknown>;
    table += `| ${keys.map((k) => String(row[k] ?? '')).join(' | ')} |\n`;
  }

  return new Handlebars.SafeString(table);
});

// 比较 helpers
Handlebars.registerHelper('gt', (a: number, b: number) => a > b);
Handlebars.registerHelper('lt', (a: number, b: number) => a < b);
Handlebars.registerHelper('gte', (a: number, b: number) => a >= b);
Handlebars.registerHelper('lte', (a: number, b: number) => a <= b);
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper('neq', (a: unknown, b: unknown) => a !== b);

// 数学 helpers
Handlebars.registerHelper('add', (a: number, b: number) => (a || 0) + (b || 0));
Handlebars.registerHelper('subtract', (a: number, b: number) => (a || 0) - (b || 0));
Handlebars.registerHelper('multiply', (a: number, b: number) => (a || 0) * (b || 0));

// 数组长度
Handlebars.registerHelper('length', (arr: unknown) => {
  if (Array.isArray(arr)) return arr.length;
  if (typeof arr === 'string') return arr.length;
  return 0;
});

// 默认值
Handlebars.registerHelper('default', (value: unknown, defaultValue: unknown) => {
  return value ?? defaultValue;
});

// ── 编译 & 渲染 ──

/**
 * 渲染 Handlebars 模板
 * @param templateStr 模板字符串
 * @param data 模板数据
 * @returns 渲染后的字符串
 */
export function renderTemplate(templateStr: string, data: Record<string, unknown>): string {
  if (!templateStr) return '';

  try {
    const compiled = Handlebars.compile(templateStr, { noEscape: true });
    return compiled(data);
  } catch (err: any) {
    throw new TemplateError(`模板渲染失败: ${err.message}`, templateStr);
  }
}

/**
 * 批量渲染节点配置中的所有模板字段
 * @param config 节点配置
 * @param data 模板数据
 * @param templateFields 需要渲染的字段名列表
 * @returns 渲染后的配置副本
 */
export function renderNodeConfig(
  config: Record<string, unknown>,
  data: Record<string, unknown>,
  templateFields: string[]
): Record<string, unknown> {
  const result = { ...config };

  for (const field of templateFields) {
    const value = result[field];
    if (typeof value === 'string' && value.includes('{{')) {
      result[field] = renderTemplate(value, data);
    }
  }

  return result;
}

// ── 异常 ──

export class TemplateError extends Error {
  templateStr: string;

  constructor(message: string, templateStr: string) {
    super(message);
    this.name = 'TemplateError';
    this.templateStr = templateStr;
  }
}
