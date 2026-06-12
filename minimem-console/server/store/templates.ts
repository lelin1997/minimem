/**
 * 模板 Store 层
 * 管理 Pipeline 内置模板
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db.js';

// ── 类型 ──

export interface TemplateRow {
  id: string;
  name: string;
  description: string;
  tags: string;
  schedule_type: string;
  schedule_cron: string | null;
  nodes: string;
  edges: string;
  variables: string;
  default_llm: string;
  created_at: string;
}

export interface TemplateDTO {
  id: string;
  name: string;
  description: string;
  tags: string[];
  schedule_type: string;
  schedule_cron: string | null;
  nodes: any[];
  edges: any[];
  variables: Record<string, string>;
  default_llm: Record<string, any>;
  created_at: string;
}

// ── 行转 DTO ──

function rowToDTO(row: TemplateRow): TemplateDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: safeParse(row.tags, []),
    schedule_type: row.schedule_type,
    schedule_cron: row.schedule_cron,
    nodes: safeParse(row.nodes, []),
    edges: safeParse(row.edges, []),
    variables: safeParse(row.variables, {}),
    default_llm: safeParse(row.default_llm, {}),
    created_at: row.created_at,
  };
}

// ── CRUD ──

export function listTemplates(): TemplateDTO[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM pipeline_templates ORDER BY created_at ASC').all() as TemplateRow[];
  return rows.map(rowToDTO);
}

export function getTemplate(id: string): TemplateDTO | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pipeline_templates WHERE id = ?').get(id) as TemplateRow | undefined;
  return row ? rowToDTO(row) : null;
}

export function createTemplate(data: {
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
  schedule_type?: string;
  schedule_cron?: string;
  nodes?: any[];
  edges?: any[];
  variables?: Record<string, string>;
  default_llm?: Record<string, any>;
}): TemplateDTO {
  const db = getDb();
  const id = data.id || randomUUID();

  // 使用 INSERT OR REPLACE 来支持 upsert（初始化模板用）
  db.prepare(`
    INSERT OR REPLACE INTO pipeline_templates (id, name, description, tags, schedule_type, schedule_cron, nodes, edges, variables, default_llm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description || '',
    JSON.stringify(data.tags || []),
    data.schedule_type || 'cron',
    data.schedule_cron || null,
    JSON.stringify(data.nodes || []),
    JSON.stringify(data.edges || []),
    JSON.stringify(data.variables || {}),
    JSON.stringify(data.default_llm || {}),
  );

  return getTemplate(id)!;
}

// ── 工具 ──

function safeParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
