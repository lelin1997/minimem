// ============================================================
// MiniMem — Surface 注入器 (TODO-015, 017, 018)
// ============================================================
// 将 Surface Files 注入到 MCP CallToolRequest 的 system prompt。
// 注入格式: <surface_files> XML 标签包裹，按文件分段。
// 总 token 预算 10000，超限时按重要性裁剪。
// 支持 etag 版本检测，变化时重新加载。

import { getDb } from '../ports/data-store.js';
import { getLogger } from '../../common/logger.js';
import { estimateTokens } from '../../common/utils.js';
import { getSurfacesVersionInfo, loadSurfacesForAgent } from './index.js';
import type { SurfaceFileName, SurfaceFile } from '../../common/types.js';

const log = getLogger('surface:injector');

// ── 注入配置 ──

/** 总 token 预算（与 surface/index.ts TOTAL_BUDGET 一致） */
const INJECTION_BUDGET = 10000;

/**
 * 文件重要性排序（裁剪时优先保留靠前的文件）
 * 基于 roadmap TODO-018: 保留 me.md + context.md + 部分 work.md
 */
const IMPORTANCE_ORDER: SurfaceFileName[] = [
  'me.md',        // 身份画像，最高优先
  'context.md',   // 当前上下文，次高
  'work.md',      // 工作记忆
  'agent.md',     // Agent 配置
  'soul.md',      // 性格偏好
  'index.md',     // 索引
  'social.md',    // 社交关系
  'life.md',      // 生活记录
  'insight.md',   // 洞察（最低，可裁）
];

// ── 缓存层（etag 驱动，TODO-017）──

interface SurfaceCache {
  etag: string;
  agentType: string;
  files: Map<SurfaceFileName, SurfaceFile>;
  injectedText: string;        // 已裁剪的注入文本
  injectedTokens: number;      // 注入文本占用 token
  cachedAt: number;            // 缓存时间戳
}

let _cache: SurfaceCache | null = null;

// ── 核心函数 ──

/**
 * 获取当前 Surface 的 etag（用于版本检测）
 */
export function getCurrentEtag(): string {
  return getSurfacesVersionInfo().etag;
}

/**
 * 检查 Surface 是否有更新（TODO-017）
 * @param knownEtag - 调用方已知的 etag（上次注入时的）
 * @returns true 表示有变化，需重新加载
 */
export function hasSurfaceChanged(knownEtag?: string): boolean {
  if (!knownEtag) return true; // 无已知 etag，视为有变化
  return getCurrentEtag() !== knownEtag;
}

/**
 * 构建 Surface 注入文本（TODO-015 + 018）
 *
 * 格式:
 * <surface_files>
 * <file name="me.md">
 * ...content...
 * </file>
 * <file name="context.md">
 * ...content...
 * </file>
 * </surface_files>
 *
 * @param agentType - Agent 类型（决定加载哪些文件）
 * @param budget - 总 token 预算，默认 10000
 * @returns { text, tokens, etag, filesIncluded, filesTrimmed }
 */
export function buildSurfaceInjection(
  agentType: string = 'general',
  budget: number = INJECTION_BUDGET,
): {
  text: string;
  tokens: number;
  etag: string;
  filesIncluded: SurfaceFileName[];
  filesTrimmed: SurfaceFileName[];
} {
  const etag = getCurrentEtag();

  // 加载该 Agent 类型的所有 Surface Files
  const allFiles = loadSurfacesForAgent(agentType);

  // 按重要性排序
  const sortedFiles = IMPORTANCE_ORDER
    .filter(name => allFiles.has(name))
    .map(name => allFiles.get(name)!);

  // token 预算裁剪 (TODO-018)
  const { included, trimmed, totalTokens } = trimToBudget(sortedFiles, budget);

  // 构建注入文本 (TODO-015)
  const parts: string[] = ['<surface_files>'];
  for (const file of included) {
    parts.push(`<file name="${file.file_name}">`);
    parts.push(file.content);
    parts.push(`</file>`);
  }
  parts.push('</surface_files>');

  const text = parts.join('\n');
  const finalTokens = estimateTokens(text);

  log.debug({
    agentType,
    etag,
    included: included.map(f => f.file_name),
    trimmed: trimmed.map(f => f.file_name),
    tokens: finalTokens,
    budget,
  }, 'Surface injection built');

  return {
    text,
    tokens: finalTokens,
    etag,
    filesIncluded: included.map(f => f.file_name),
    filesTrimmed: trimmed.map(f => f.file_name),
  };
}

/**
 * 按重要性裁剪到预算内 (TODO-018)
 * 策略:
 *   1. 按 IMPORTANCE_ORDER 顺序逐个加入
 *   2. 超预算时，跳过低优先级文件
 *   3. 至少保留 me.md + context.md（即使超预算也保留这两个的核心段）
 */
function trimToBudget(
  files: SurfaceFile[],
  budget: number,
): { included: SurfaceFile[]; trimmed: SurfaceFile[]; totalTokens: number } {
  const included: SurfaceFile[] = [];
  const trimmed: SurfaceFile[] = [];
  let usedTokens = 0;

  // XML 标签开销估算（<surface_files> + </surface_files> + 各文件标签）
  const overhead = estimateTokens('<surface_files>\n</surface_files>') + files.length * estimateTokens('<file name="xx.md">\n</file>\n');
  let remaining = budget - overhead;

  for (const file of files) {
    const fileTokens = estimateTokens(file.content);

    if (fileTokens <= remaining) {
      // 完整放入
      included.push(file);
      usedTokens += fileTokens;
      remaining -= fileTokens;
    } else if (file.file_name === 'me.md' || file.file_name === 'context.md') {
      // 核心文件：截断后保留（至少保留前 50%）
      const keepRatio = Math.max(0.5, remaining / fileTokens);
      const cutPoint = Math.floor(file.content.length * keepRatio);
      const truncated: SurfaceFile = {
        ...file,
        content: file.content.slice(0, cutPoint) + '\n<!-- truncated for budget -->',
      };
      included.push(truncated);
      usedTokens += estimateTokens(truncated.content);
      remaining = 0;
      log.info({ file: file.file_name, keepRatio }, 'Core surface file truncated for budget');
    } else {
      // 非核心文件：跳过
      trimmed.push(file);
      log.debug({ file: file.file_name, fileTokens, remaining }, 'Surface file trimmed (budget exceeded)');
    }
  }

  return { included, trimmed, totalTokens: usedTokens + overhead };
}

// ── 缓存注入（TODO-017 完整实现）──

/**
 * 获取注入文本（带 etag 缓存）
 * 如果 Surface 未变化，返回缓存的注入文本；否则重新构建。
 *
 * @param agentType - Agent 类型
 * @param knownEtag - 调用方已知的 etag（可选）
 * @returns 注入结果 + 是否命中缓存
 */
export function getInjectionWithCache(
  agentType: string = 'general',
  knownEtag?: string,
): { text: string; tokens: number; etag: string; cached: boolean } {
  const currentEtag = getCurrentEtag();

  // 缓存命中：agentType 一致 + etag 一致
  if (
    _cache &&
    _cache.agentType === agentType &&
    _cache.etag === currentEtag &&
    (!knownEtag || knownEtag === currentEtag)
  ) {
    log.debug({ etag: currentEtag }, 'Surface injection cache hit');
    return {
      text: _cache.injectedText,
      tokens: _cache.injectedTokens,
      etag: currentEtag,
      cached: true,
    };
  }

  // 缓存未命中：重新构建
  const injection = buildSurfaceInjection(agentType);

  _cache = {
    etag: injection.etag,
    agentType,
    files: new Map(), // files 不缓存到内存（避免占用），按需从 DB 加载
    injectedText: injection.text,
    injectedTokens: injection.tokens,
    cachedAt: Date.now(),
  };

  log.info({ etag: currentEtag, tokens: injection.tokens, cached: false }, 'Surface injection rebuilt');
  return {
    text: injection.text,
    tokens: injection.tokens,
    etag: currentEtag,
    cached: false,
  };
}

/**
 * 清除注入缓存（供测试和 surface 编辑后调用）
 */
export function clearInjectionCache(): void {
  _cache = null;
  log.debug('Surface injection cache cleared');
}

// ── 中间件入口（TODO-016）──

/**
 * 为 MCP CallToolRequest 生成注入到 system prompt 的 Surface 片段
 *
 * 用法（在 mcp-server.ts 的 CallToolRequest handler 中）:
 *   const surfacePrompt = injectSurfaceForToolCall(client.agentType);
 *   // 将 surfacePrompt 追加到 LLM 调用的 system message
 *
 * @param agentType - Agent 类型
 * @returns 注入文本（含 <surface_files> 标签），或空字符串（无 Surface 时）
 */
export function injectSurfaceForToolCall(agentType: string = 'general'): string {
  try {
    const injection = getInjectionWithCache(agentType);
    if (injection.tokens === 0) {
      return '';
    }
    return injection.text;
  } catch (err) {
    // Surface 注入失败不应阻塞工具调用
    log.warn({ err }, 'Surface injection failed, returning empty');
    return '';
  }
}
