// ============================================================
// MiniMem — Surface Files 引擎
// ============================================================
// 管理 8 个 Markdown 文件，总预算 ≤ 10K tokens
// 数据库为 Single Source of Truth，同时同步到磁盘 .md 文件和 Skill references

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../store/database.js';
import { getLogger } from '../common/logger.js';
import { generateId, now, estimateTokens } from '../common/utils.js';
import { getLLM } from '../llm/client.js';
import { getConfig } from '../config/index.js';
import { surfaceBudgetCompressPrompt, surfaceSmartMergePrompt } from '../llm/prompts.js';
import type { SurfaceFileName, SurfaceFile } from '../common/types.js';

const log = getLogger('surface');

// ── Surface File 预算配置 ──

const FILE_BUDGETS: Record<SurfaceFileName, number> = {
  'me.md': 800,
  'soul.md': 1200,
  'work.md': 1500,
  'social.md': 1200,
  'life.md': 1000,
  'agent.md': 1000,
  'context.md': 1500,
  'index.md': 800,
  'insight.md': 1000,
};

/** 所有文件基础预算总额 */
const TOTAL_BUDGET = 10000;

/** 单文件最大可借用倍率（基础预算的 1.5 倍） */
const MAX_BORROW_RATIO = 1.5;

// ── Agent 类型到文件映射 ──

const AGENT_FILE_MAP: Record<string, SurfaceFileName[]> = {
  codebuddy: ['me.md', 'work.md', 'agent.md', 'context.md'],
  openclaw: ['me.md', 'soul.md', 'social.md', 'context.md'],
  general: ['me.md', 'soul.md', 'work.md', 'social.md', 'life.md', 'agent.md', 'context.md', 'index.md'],
};

/**
 * 获取单个 Surface File
 */
export function getSurfaceFile(fileName: SurfaceFileName): SurfaceFile | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM surface_files WHERE file_name = ?').get(fileName) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToSurfaceFile(row);
}

/**
 * 按 Agent 类型加载 Surface Files
 */
export function loadSurfacesForAgent(agentType: string): Map<SurfaceFileName, SurfaceFile> {
  const fileNames = AGENT_FILE_MAP[agentType] ?? AGENT_FILE_MAP.general;
  const result = new Map<SurfaceFileName, SurfaceFile>();

  for (const fileName of fileNames) {
    const file = getSurfaceFile(fileName);
    if (file) {
      result.set(fileName, file);
    }
  }

  log.debug({ agentType, fileCount: result.size }, 'Surface files loaded');
  return result;
}

/**
 * 获取所有 Surface Files 的合并内容（用于上下文注入）
 */
export function getSurfacesAsContext(agentType: string): string {
  const files = loadSurfacesForAgent(agentType);
  const parts: string[] = [];

  for (const [name, file] of files) {
    parts.push(`--- ${name} ---\n${file.content}`);
  }

  return parts.join('\n\n');
}

/**
 * 动态预算：允许文件从未使用的配额中借用
 * 最多可用到基础预算的 MAX_BORROW_RATIO 倍，但不超过总剩余空间
 */
function getDynamicBudget(fileName: SurfaceFileName): number {
  const baseBudget = FILE_BUDGETS[fileName] ?? 1500;

  try {
    const stats = getSurfaceStats();
    const currentFileTokens = stats.files[fileName]?.tokens ?? 0;
    const usedByOthers = stats.total_tokens - currentFileTokens;
    const availableForThis = TOTAL_BUDGET - usedByOthers;

    const maxBudget = Math.floor(baseBudget * MAX_BORROW_RATIO);
    const dynamicBudget = Math.min(maxBudget, availableForThis);

    // 至少返回基础预算（不能因其他文件超标而压缩自己）
    return Math.max(baseBudget, dynamicBudget);
  } catch {
    // 获取统计失败时退回基础预算
    return baseBudget;
  }
}

/**
 * 更新 Surface File 内容
 * 超预算时采用分层降级策略（而非粗暴截断）
 */
export function updateSurfaceFile(fileName: SurfaceFileName, newContent: string, changeSummary: string = ''): void {
  const db = getDb();
  const budget = getDynamicBudget(fileName);

  // Token 检查
  const tokens = estimateTokens(newContent);
  let content = newContent;

  if (tokens > budget) {
    log.warn({ fileName, tokens, budget }, 'Content exceeds budget, applying graceful reduction');
    content = gracefulBudgetReduceSync(fileName, content, budget);
  }

  const tokenCount = estimateTokens(content);
  const timestamp = now();

  // 保存历史版本
  const currentFile = getSurfaceFile(fileName);
  if (currentFile) {
    db.prepare(`
      INSERT INTO surface_file_history (id, file_name, content, version, change_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(generateId(), fileName, currentFile.content, currentFile.version, changeSummary, timestamp);
  }

  // 更新当前文件
  db.prepare(`
    UPDATE surface_files
    SET content = ?, token_count = ?, version = version + 1, updated_at = ?
    WHERE file_name = ?
  `).run(content, tokenCount, timestamp, fileName);

  // 同步到磁盘 .md 文件
  syncSurfaceFileToDisk(fileName, content);

  // 同步到 Skill references 目录（让 CodeBuddy Skill 可直接读取）
  syncSurfaceToSkillReferences(fileName, content);

  log.info({ fileName, tokens: tokenCount, budget, baseBudget: FILE_BUDGETS[fileName] }, 'Surface file updated');
}

// ── 分层降级策略（同步版，不依赖 LLM） ──

/**
 * 分层降级压缩策略（同步版本）
 *
 * Level 1: 按段落优先级删除低价值段落
 * Level 2: 按段落边界截断
 * Level 3: 硬截断（最后防线）
 *
 * 注意：LLM 智能压缩在 smartUpdateSurfaceFile (异步版) 中处理，
 * 此处为同步调用链，不使用 LLM。
 */
function gracefulBudgetReduceSync(
  fileName: SurfaceFileName,
  content: string,
  budget: number,
): string {
  const originalTokens = estimateTokens(content);

  // ── Level 1: 按段落优先级删除 ──
  const sections = content.split(/\n(?=## )/);
  if (sections.length > 1) {
    const sorted = sections
      .map((s, i) => ({ content: s, index: i, tokens: estimateTokens(s) }))
      .sort((a, b) => b.tokens - a.tokens);

    let totalTokens = originalTokens;
    const removed: number[] = [];

    for (const section of sorted) {
      if (totalTokens <= budget) break;
      if (section.index === 0) continue; // 保留第一段（通常是标题/概述）
      totalTokens -= section.tokens;
      removed.push(section.index);
    }

    if (removed.length > 0 && totalTokens <= budget) {
      const kept = sections.filter((_, i) => !removed.includes(i));
      const result = kept.join('\n') + '\n\n> ℹ️ 部分内容因预算限制已被精简';
      log.info({
        fileName,
        level: 1,
        removedSections: removed.length,
        before: originalTokens,
        after: estimateTokens(result),
      }, 'Budget reduction: section pruning succeeded');
      return result;
    }
  }

  // ── Level 2: 按段落边界截断 ──
  const paragraphs = content.split('\n\n');
  let accumulated = '';
  for (const para of paragraphs) {
    const candidate = accumulated ? accumulated + '\n\n' + para : para;
    if (estimateTokens(candidate) > budget * 0.95) break;
    accumulated = candidate;
  }

  if (accumulated) {
    const result = accumulated + '\n\n> ⚠️ 后续内容因预算限制已省略';
    log.info({
      fileName,
      level: 2,
      before: originalTokens,
      after: estimateTokens(result),
    }, 'Budget reduction: paragraph-boundary truncation');
    return result;
  }

  // ── Level 3: 硬截断（最后防线）──
  const ratio = budget / originalTokens;
  const targetLen = Math.floor(content.length * ratio * 0.90);
  const result = content.slice(0, targetLen) + '\n\n> 🚨 内容已截断以控制预算';
  log.warn({
    fileName,
    level: 3,
    before: originalTokens,
    after: estimateTokens(result),
  }, 'Budget reduction: hard truncation (last resort)');
  return result;
}

/**
 * 分层降级压缩策略（异步版本，支持 LLM 智能压缩）
 * 在 smartUpdateSurfaceFile 等异步场景下使用
 *
 * Level 0: LLM 智能压缩（保留语义，精简表达）
 * Level 1: 按段落优先级删除低价值段落
 * Level 2: 按段落边界截断
 * Level 3: 硬截断（最后防线）
 */
async function gracefulBudgetReduceAsync(
  fileName: SurfaceFileName,
  content: string,
  budget: number,
): Promise<string> {
  const originalTokens = estimateTokens(content);

  // ── Level 0: LLM 智能压缩 ──
  const llm = getLLM();
  if (llm.isAvailable) {
    try {
      // prompt 统一由 prompts.ts 管理
      const compressed = await llm.chat({
        messages: surfaceBudgetCompressPrompt(budget, content),
        tier: 'light',
        temperature: 0.2,
      });

      if (estimateTokens(compressed.content) <= budget) {
        log.info({
          fileName,
          level: 0,
          before: originalTokens,
          after: estimateTokens(compressed.content),
        }, 'Budget reduction: LLM compression succeeded');
        return compressed.content;
      }
    } catch (err) {
      log.warn({ err }, 'Budget reduction: LLM compression failed, falling back');
    }
  }

  // LLM 不可用或压缩后仍超预算，回退到同步策略
  return gracefulBudgetReduceSync(fileName, content, budget);
}

/**
 * 智能合并更新（LLM 辅助）
 * 使用动态预算 + 异步降级策略
 */
export async function smartUpdateSurfaceFile(
  fileName: SurfaceFileName,
  newInfo: string,
  changeSummary: string = '',
): Promise<void> {
  const llm = getLLM();
  const currentFile = getSurfaceFile(fileName);

  if (!currentFile) {
    updateSurfaceFile(fileName, newInfo, changeSummary);
    return;
  }

  if (!llm.isAvailable) {
    // 降级：直接追加
    const updated = `${currentFile.content}\n\n## 最近更新\n${newInfo}`;
    updateSurfaceFile(fileName, updated, changeSummary);
    return;
  }

  const budget = getDynamicBudget(fileName);

  try {
    // prompt 统一由 prompts.ts 管理
    const result = await llm.chat({
      messages: surfaceSmartMergePrompt(fileName, budget, currentFile.content, newInfo),
      tier: 'light',
      temperature: 0.3,
    });

    // LLM 合并后仍可能超预算，使用异步降级策略再次检查
    let mergedContent = result.content;
    if (estimateTokens(mergedContent) > budget) {
      log.warn({ fileName, tokens: estimateTokens(mergedContent), budget }, 'LLM merge result exceeds budget, applying async reduction');
      mergedContent = await gracefulBudgetReduceAsync(fileName, mergedContent, budget);
    }

    updateSurfaceFile(fileName, mergedContent, changeSummary);
  } catch (err) {
    log.warn({ err }, 'Smart update failed, fallback to append');
    const updated = `${currentFile.content}\n\n## 最近更新\n${newInfo}`;
    updateSurfaceFile(fileName, updated, changeSummary);
  }
}

/**
 * 处理更新队列（由做梦引擎调用）
 * @param filterFiles - 可选：只处理指定文件名列表中的更新
 */
export async function processUpdateQueue(filterFiles?: SurfaceFileName[]): Promise<number> {
  const db = getDb();

  let pending: Array<{ id: string; file_name: string; suggestion: string; importance: number }>;

  if (filterFiles && filterFiles.length > 0) {
    const placeholders = filterFiles.map(() => '?').join(', ');
    pending = db.prepare(
      `SELECT * FROM surface_update_queue WHERE status = 'pending' AND file_name IN (${placeholders}) ORDER BY importance DESC LIMIT 10`
    ).all(...filterFiles) as typeof pending;
  } else {
    pending = db.prepare(
      "SELECT * FROM surface_update_queue WHERE status = 'pending' ORDER BY importance DESC LIMIT 10"
    ).all() as typeof pending;
  }

  if (pending.length === 0) return 0;

  let processed = 0;
  for (const item of pending) {
    try {
      await smartUpdateSurfaceFile(
        item.file_name as SurfaceFileName,
        item.suggestion,
        `Queue item ${item.id}`,
      );
      db.prepare("UPDATE surface_update_queue SET status = 'applied', processed_at = ? WHERE id = ?").run(now(), item.id);
      processed++;
    } catch (err) {
      log.warn({ err, id: item.id }, 'Failed to process surface update');
      db.prepare("UPDATE surface_update_queue SET status = 'rejected', processed_at = ? WHERE id = ?").run(now(), item.id);
    }
  }

  log.info({ processed, total: pending.length }, 'Surface update queue processed');
  return processed;
}

/**
 * 获取所有文件的 Token 使用统计
 */
export function getSurfaceStats(): { total_tokens: number; budget: number; files: Record<string, { tokens: number; budget: number }> } {
  const db = getDb();
  const rows = db.prepare('SELECT file_name, token_count, budget_tokens FROM surface_files').all() as Array<{ file_name: string; token_count: number; budget_tokens: number }>;

  let totalTokens = 0;
  const files: Record<string, { tokens: number; budget: number }> = {};

  for (const row of rows) {
    totalTokens += row.token_count;
    files[row.file_name] = { tokens: row.token_count, budget: row.budget_tokens };
  }

  return { total_tokens: totalTokens, budget: 10000, files };
}

/**
 * Issue-22: 获取 Surfaces 版本信息（etag + 各文件版本号）
 * Agent 通过比较 etag 判断是否需要重新加载 Surface Files
 */
export function getSurfacesVersionInfo(): { etag: string; surfaces_version: Record<string, number>; last_updated: string } {
  const db = getDb();
  const rows = db.prepare('SELECT file_name, version, updated_at FROM surface_files ORDER BY file_name').all() as Array<{
    file_name: string;
    version: number;
    updated_at: string;
  }>;

  const surfacesVersion: Record<string, number> = {};
  let latestUpdate = '';

  for (const row of rows) {
    surfacesVersion[row.file_name] = row.version;
    if (row.updated_at > latestUpdate) {
      latestUpdate = row.updated_at;
    }
  }

  // etag = 各文件 version 的合并 hash
  const versionString = rows.map(r => `${r.file_name}:${r.version}`).join('|');
  const etag = simpleHash(versionString);

  return { etag, surfaces_version: surfacesVersion, last_updated: latestUpdate };
}

/**
 * 简单的字符串哈希（用于 etag 生成，不需要密码学安全）
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// ── 工具函数 ──

function rowToSurfaceFile(row: Record<string, unknown>): SurfaceFile {
  return {
    file_name: row.file_name as SurfaceFileName,
    content: row.content as string,
    token_count: row.token_count as number,
    budget_tokens: row.budget_tokens as number,
    version: row.version as number,
    updated_at: row.updated_at as string,
  };
}

// ── 磁盘同步 ──

/**
 * 获取 surfaces 磁盘目录路径
 */
function getSurfacesDir(): string {
  const config = getConfig();
  return join(config.storage.data_dir, 'surfaces');
}

/**
 * 将单个 Surface File 同步到磁盘
 * 在 updateSurfaceFile 后自动调用
 */
function syncSurfaceFileToDisk(fileName: SurfaceFileName, content: string): void {
  try {
    const dir = getSurfacesDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filePath = join(dir, fileName);
    writeFileSync(filePath, content, 'utf-8');
    log.debug({ fileName, path: filePath }, 'Surface file synced to disk');
  } catch (err) {
    // 磁盘同步失败不应影响核心流程，仅打日志
    log.warn({ err, fileName }, 'Failed to sync surface file to disk');
  }
}

/**
 * 将所有 Surface Files 批量同步到磁盘
 * 适用于启动时、做梦结束后等场景
 * 同时同步到 Skill references 目录
 */
export function syncAllSurfacesToDisk(): number {
  const db = getDb();
  const rows = db.prepare('SELECT file_name, content FROM surface_files').all() as Array<{
    file_name: string;
    content: string;
  }>;

  const dir = getSurfacesDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let synced = 0;
  for (const row of rows) {
    try {
      const filePath = join(dir, row.file_name);
      writeFileSync(filePath, row.content, 'utf-8');

      // 同时同步到 Skill references
      syncSurfaceToSkillReferences(row.file_name as SurfaceFileName, row.content);

      synced++;
    } catch (err) {
      log.warn({ err, fileName: row.file_name }, 'Failed to sync surface file to disk');
    }
  }

  log.info({ synced, total: rows.length, dir }, 'All surface files synced to disk');
  return synced;
}

// ── Skill References 同步 ──

/**
 * 获取 Skill references 目录路径
 *
 * 目录定位逻辑：
 * 1. 环境变量 MINIMEM_SKILL_DIR（最高优先级，方便测试）
 * 2. 项目根目录的 references/ 子目录（SKILL.md 所在位置）
 *
 * 按照 CodeBuddy Skill 的 references 约定：
 * references/ 目录中的文件"旨在根据需要加载到上下文中以辅助 AI 思考"，
 * 正好适合放置 Surface Files 作为用户上下文。
 */
function getSkillReferencesDir(): string {
  if (process.env.MINIMEM_SKILL_DIR) {
    return join(process.env.MINIMEM_SKILL_DIR, 'references');
  }
  // 用 import.meta.url 定位项目根的 references/，不依赖 process.cwd()
  // surface/index.ts 在 src/surface/ 下，向上两级是项目根
  // tsup 打包后 dist/index.js 是单文件，向上一级是项目根
  const __surfaceFile = fileURLToPath(import.meta.url);
  const __surfaceDir = dirname(__surfaceFile);
  // 向上查找 SKILL.md 所在目录（即项目根）
  let dir = __surfaceDir;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'SKILL.md'))) {
      return join(dir, 'references');
    }
    dir = dirname(dir);
  }
  // fallback: process.cwd()
  return join(process.cwd(), 'references');
}

/**
 * 将单个 Surface File 同步到 Skill 的 references 目录
 *
 * 这使得 CodeBuddy 触发 MiniMem Skill 时，
 * SKILL.md 中的指令可以要求 AI 读取 references/ 下的文件，
 * 从而将 Surface 内容可靠地加载到 LLM 上下文中。
 *
 * 同步失败不影响核心流程（纯尽力而为）。
 */
function syncSurfaceToSkillReferences(fileName: SurfaceFileName, content: string): void {
  try {
    const dir = getSkillReferencesDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filePath = join(dir, fileName);
    writeFileSync(filePath, content, 'utf-8');
    log.debug({ fileName, path: filePath }, 'Surface file synced to Skill references');
  } catch (err) {
    // references 同步失败不应影响核心流程
    log.warn({ err, fileName }, 'Failed to sync surface file to Skill references');
  }
}
