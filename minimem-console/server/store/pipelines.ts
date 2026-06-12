/**
 * Pipeline Store 层
 * SQLite CRUD 操作
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db.js';

// ── 类型 ──

export interface PipelineRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  tags: string;
  schedule_type: string;
  schedule_cron: string | null;
  schedule_event: string | null;
  nodes: string;
  edges: string;
  variables: string;
  default_llm: string;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineDTO {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  schedule_type: string;
  schedule_cron: string | null;
  schedule_event: string | null;
  nodes: any[];
  edges: any[];
  variables: Record<string, string>;
  default_llm: Record<string, any>;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

// ── 行转 DTO ──

function rowToDTO(row: PipelineRow): PipelineDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    tags: safeParse(row.tags, []),
    schedule_type: row.schedule_type,
    schedule_cron: row.schedule_cron,
    schedule_event: row.schedule_event,
    nodes: safeParse(row.nodes, []),
    edges: safeParse(row.edges, []),
    variables: safeParse(row.variables, {}),
    default_llm: safeParse(row.default_llm, {}),
    last_run_at: row.last_run_at,
    last_run_status: row.last_run_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── CRUD ──

export function listPipelines(): PipelineDTO[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM pipelines ORDER BY updated_at DESC').all() as PipelineRow[];
  return rows.map(rowToDTO);
}

export function getPipeline(id: string): PipelineDTO | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as PipelineRow | undefined;
  return row ? rowToDTO(row) : null;
}

export function createPipeline(data: {
  name: string;
  description?: string;
  tags?: string[];
  schedule_type?: string;
  schedule_cron?: string;
  schedule_event?: string;
  nodes?: any[];
  edges?: any[];
  variables?: Record<string, string>;
  default_llm?: Record<string, any>;
}): PipelineDTO {
  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO pipelines (id, name, description, tags, schedule_type, schedule_cron, schedule_event, nodes, edges, variables, default_llm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description || '',
    JSON.stringify(data.tags || []),
    data.schedule_type || 'manual',
    data.schedule_cron || null,
    data.schedule_event || null,
    JSON.stringify(data.nodes || []),
    JSON.stringify(data.edges || []),
    JSON.stringify(data.variables || {}),
    JSON.stringify(data.default_llm || {}),
  );

  return getPipeline(id)!;
}

export function updatePipeline(id: string, data: Partial<{
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  schedule_type: string;
  schedule_cron: string | null;
  schedule_event: string | null;
  nodes: any[];
  edges: any[];
  variables: Record<string, string>;
  default_llm: Record<string, any>;
}>): PipelineDTO | null {
  const db = getDb();
  const existing = getPipeline(id);
  if (!existing) return null;

  const sets: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { sets.push('description = ?'); values.push(data.description); }
  if (data.enabled !== undefined) { sets.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (data.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(data.tags)); }
  if (data.schedule_type !== undefined) { sets.push('schedule_type = ?'); values.push(data.schedule_type); }
  if (data.schedule_cron !== undefined) { sets.push('schedule_cron = ?'); values.push(data.schedule_cron); }
  if (data.schedule_event !== undefined) { sets.push('schedule_event = ?'); values.push(data.schedule_event); }
  if (data.nodes !== undefined) { sets.push('nodes = ?'); values.push(JSON.stringify(data.nodes)); }
  if (data.edges !== undefined) { sets.push('edges = ?'); values.push(JSON.stringify(data.edges)); }
  if (data.variables !== undefined) { sets.push('variables = ?'); values.push(JSON.stringify(data.variables)); }
  if (data.default_llm !== undefined) { sets.push('default_llm = ?'); values.push(JSON.stringify(data.default_llm)); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE pipelines SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return getPipeline(id)!;
}

export function deletePipeline(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
  return result.changes > 0;
}

export function togglePipeline(id: string): PipelineDTO | null {
  const db = getDb();
  const existing = getPipeline(id);
  if (!existing) return null;

  const newEnabled = existing.enabled ? 0 : 1;
  db.prepare("UPDATE pipelines SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(newEnabled, id);

  return getPipeline(id)!;
}

// ── 工具函数 ──

function safeParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
