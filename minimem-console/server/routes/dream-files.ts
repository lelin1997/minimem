/**
 * Dream 报告路由
 * 读取 MiniMem 的 data/dreams/ 目录下的文件
 */

import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config.js';

export const dreamRoutes = new Hono();

interface DreamFile {
  id: string;
  filename: string;
  date: string;
  type: 'json' | 'md';
  size: number;
  /** 该 dream 拥有哪些格式 */
  formats: ('json' | 'md')[];
}

// 列出所有 Dream 报告（按名称去重，同名 .json/.md 合并为一条）
dreamRoutes.get('/', (c) => {
  const config = getConfig();
  const dreamsDir = path.join(config.minimem.data_dir, 'dreams');

  if (!fs.existsSync(dreamsDir)) {
    return c.json({ dreams: [] });
  }

  try {
    const files = fs.readdirSync(dreamsDir)
      .filter((f) => f.endsWith('.json') || f.endsWith('.md'))
      .sort((a, b) => b.localeCompare(a)); // 倒序

    // 按去掉扩展名后的 id 分组
    const grouped = new Map<string, { formats: ('json' | 'md')[]; date: string; size: number; filename: string }>();

    for (const filename of files) {
      const fullPath = path.join(dreamsDir, filename);
      const stats = fs.statSync(fullPath);
      const ext = path.extname(filename).slice(1) as 'json' | 'md';
      const id = filename.replace(/\.[^.]+$/, '');

      // 尝试匹配文件名中的日期+时间（支持多种分隔符格式）
      // 例: dream_daily_2026-04-29T14-30-00.md / dream_2026-04-29_143000.json / 2026-04-29.md
      const dtMatch = filename.match(/(\d{4}[-_]\d{2}[-_]\d{2})[T_-](\d{2})[-:]?(\d{2})[-:]?(\d{2})/);
      const dateOnlyMatch = !dtMatch && filename.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
      let date: string;
      if (dtMatch) {
        // 有精确时间：拼成 YYYY-MM-DD HH:mm:ss
        const d = dtMatch[1].replace(/_/g, '-');
        date = `${d} ${dtMatch[2]}:${dtMatch[3]}:${dtMatch[4]}`;
      } else if (dateOnlyMatch) {
        // 只有日期，用文件修改时间补充时分秒
        const d = dateOnlyMatch[1].replace(/_/g, '-');
        const time = stats.mtime.toTimeString().slice(0, 8); // HH:mm:ss
        date = `${d} ${time}`;
      } else {
        // 完全无日期信息，用文件修改时间
        const iso = stats.mtime.toISOString();
        date = iso.replace('T', ' ').slice(0, 19);
      }

      if (grouped.has(id)) {
        const existing = grouped.get(id)!;
        existing.formats.push(ext);
        existing.size += stats.size;
      } else {
        grouped.set(id, { formats: [ext], date, size: stats.size, filename });
      }
    }

    // 转为数组，按日期倒序（最新在前）
    const dreams: DreamFile[] = Array.from(grouped.entries())
      .sort(([, a], [, b]) => b.date.localeCompare(a.date))
      .map(([id, info]) => ({
        id,
        filename: info.filename,
        date: info.date,
        type: info.formats.includes('md') ? 'md' as const : 'json' as const, // 默认展示类型
        size: info.size,
        formats: info.formats.sort(), // ['json', 'md']
      }));

    return c.json({ dreams });
  } catch (err: any) {
    return c.json({ dreams: [], error: err.message });
  }
});

// 获取单个 Dream 报告详情（支持 ?format=json|md 指定格式）
dreamRoutes.get('/:id', (c) => {
  const config = getConfig();
  const dreamsDir = path.join(config.minimem.data_dir, 'dreams');
  const id = c.req.param('id');
  const preferFormat = c.req.query('format') as 'json' | 'md' | undefined;

  // 检测可用格式
  const available: ('json' | 'md')[] = [];
  for (const ext of ['json', 'md'] as const) {
    if (fs.existsSync(path.join(dreamsDir, `${id}.${ext}`))) {
      available.push(ext);
    }
  }

  if (available.length === 0) {
    return c.json({ error: 'Dream 报告不存在' }, 404);
  }

  // 优先使用请求的格式，否则默认 md > json
  const ext = preferFormat && available.includes(preferFormat)
    ? preferFormat
    : available.includes('md') ? 'md' : 'json';

  const filename = `${id}.${ext}`;
  const fullPath = path.join(dreamsDir, filename);
  const content = fs.readFileSync(fullPath, 'utf-8');

  if (ext === 'json') {
    try {
      const data = JSON.parse(content);
      return c.json({ id, filename, type: 'json', data, content: JSON.stringify(data, null, 2), formats: available });
    } catch {
      return c.json({ id, filename, type: 'json', content, formats: available });
    }
  } else {
    return c.json({ id, filename, type: 'md', content, formats: available });
  }
});
