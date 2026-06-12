/**
 * 运行记录 Store 层
 * 查询 pipeline_runs / node_runs / pipeline_outputs
 */

import { getDb } from '../db.js';

// ── 类型 ──

export interface RunRow {
  id: string;
  pipeline_id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface NodeRunRow {
  id: string;
  run_id: string;
  node_id: string;
  node_label: string;
  node_type: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  input_snapshot: string | null;
  output_snapshot: string | null;
  error: string | null;
  llm_usage: string | null;
  created_at: string;
}

export interface OutputRow {
  id: string;
  run_id: string;
  node_id: string;
  node_label: string;
  output_type: string;
  preview: string;
  full_content: string;
  file_path: string | null;
  created_at: string;
}

// ── 查询 ──

/** 获取某 Pipeline 的运行记录（分页） */
export function listRunsByPipeline(pipelineId: string, page = 1, pageSize = 20): {
  runs: RunRow[];
  total: number;
} {
  const db = getDb();

  const total = (db.prepare('SELECT COUNT(*) as count FROM pipeline_runs WHERE pipeline_id = ?').get(pipelineId) as any).count;

  const runs = db.prepare(`
    SELECT * FROM pipeline_runs
    WHERE pipeline_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(pipelineId, pageSize, (page - 1) * pageSize) as RunRow[];

  return { runs, total };
}

/** 获取所有运行记录（全局，分页） */
export function listAllRuns(page = 1, pageSize = 20): {
  runs: (RunRow & { pipeline_name?: string })[];
  total: number;
} {
  const db = getDb();

  const total = (db.prepare('SELECT COUNT(*) as count FROM pipeline_runs').get() as any).count;

  const runs = db.prepare(`
    SELECT r.*, p.name as pipeline_name
    FROM pipeline_runs r
    LEFT JOIN pipelines p ON r.pipeline_id = p.id
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, (page - 1) * pageSize) as (RunRow & { pipeline_name?: string })[];

  return { runs, total };
}

/** 获取单次运行详情 */
export function getRun(runId: string): RunRow | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId) as RunRow) || null;
}

/** 获取运行的所有节点记录 */
export function getNodeRuns(runId: string): NodeRunRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM node_runs WHERE run_id = ? ORDER BY started_at ASC
  `).all(runId) as NodeRunRow[];
}

/** 获取运行的某个节点详情 */
export function getNodeRun(runId: string, nodeId: string): NodeRunRow | null {
  const db = getDb();
  return (db.prepare(`
    SELECT * FROM node_runs WHERE run_id = ? AND node_id = ?
  `).get(runId, nodeId) as NodeRunRow) || null;
}

/** 获取运行的所有输出 */
export function getRunOutputs(runId: string): OutputRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM pipeline_outputs WHERE run_id = ? ORDER BY created_at ASC
  `).all(runId) as OutputRow[];
}

/** 获取单个输出详情 */
export function getOutput(outputId: string): OutputRow | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM pipeline_outputs WHERE id = ?').get(outputId) as OutputRow) || null;
}

/** 获取最近的运行记录（用于 Dashboard） */
export function getRecentRuns(limit = 5): (RunRow & { pipeline_name?: string })[] {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, p.name as pipeline_name
    FROM pipeline_runs r
    LEFT JOIN pipelines p ON r.pipeline_id = p.id
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(limit) as (RunRow & { pipeline_name?: string })[];
}
