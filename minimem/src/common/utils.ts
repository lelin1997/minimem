// ============================================================
// MiniMem — ID 生成与工具函数
// ============================================================

import { nanoid } from 'nanoid';

/**
 * 生成唯一 ID（21 字符 nanoid）
 */
export function generateId(): string {
  return nanoid();
}

/**
 * 生成短 ID（10 字符）
 */
export function generateShortId(): string {
  return nanoid(10);
}

/**
 * 获取当前时间的 ISO 8601 字符串
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 截断字符串
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * 简易 Token 估算（约 4 字符 = 1 token，中文约 2 字符 = 1 token）
 */
export function estimateTokens(text: string): number {
  // 简单启发式：中文字符按 2:1，英文按 4:1
  let tokens = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      tokens += 0.5; // CJK 字符
    } else {
      tokens += 0.25; // ASCII
    }
  }
  return Math.ceil(tokens);
}

/**
 * 按 token 预算截断文本
 *
 * 当估算 token 数超出 maxTokens 时，从尾部截断并追加 truncation 标记。
 * 中文/CJK 按 ~2 字符/token 切割，英文按 ~4 字符/token 切割。
 *
 * @param text      - 待截断的文本
 * @param maxTokens - 最大 token 数（默认 6000）
 * @returns 截断后的文本（含标记）或原文
 */
export function truncateForLLM(text: string, maxTokens: number = 6000): { text: string; truncated: boolean; originalTokens: number } {
  const originalTokens = estimateTokens(text);
  if (originalTokens <= maxTokens) {
    return { text, truncated: false, originalTokens };
  }

  // 按字符逐步截断，目标是 maxTokens - 50（为 truncation 标记留余量）
  const targetTokens = maxTokens - 50;
  let tokens = 0;
  let cutIndex = 0;

  for (const char of text) {
    const cost = char.charCodeAt(0) > 127 ? 0.5 : 0.25;
    if (tokens + cost > targetTokens) break;
    tokens += cost;
    cutIndex += char.length; // 处理代理对
  }

  const truncatedText = text.slice(0, cutIndex) + `\n\n[... 内容已截断：原始约 ${originalTokens} tokens，保留约 ${Math.ceil(tokens)} tokens ...]`;
  return { text: truncatedText, truncated: true, originalTokens };
}

// ── Prompt Injection 防护 ──

/**
 * 常见 Prompt Injection 攻击模式
 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // 角色劫持
  { pattern: /(?:^|\n)\s*(?:system|assistant)\s*:/i, label: 'role-hijack' },
  // 指令覆盖
  { pattern: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|rules?|context)/i, label: 'instruction-override' },
  // 新角色注入
  { pattern: /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s*'?re)|from\s+now\s+on\s+you)/i, label: 'role-injection' },
  // prompt 泄露探测
  { pattern: /(?:repeat|show|reveal|output|print)\s+(?:your|the|system)\s+(?:prompt|instructions?|rules?)/i, label: 'prompt-leak' },
  // 分隔符注入（试图插入新的 system 消息）
  { pattern: /(?:```\s*system|<\|im_start\|>|<\|system\|>|\[INST\]|\[\/INST\])/i, label: 'delimiter-injection' },
  // 中文变体
  { pattern: /(?:忽略|无视|忘记)\s*(?:之前|上面|以上)\s*(?:的)?(?:指令|规则|提示|要求)/i, label: 'instruction-override-zh' },
  { pattern: /(?:你现在是|你要扮演|从现在开始你是)/i, label: 'role-injection-zh' },
];

/**
 * 清洗用户内容中的 Prompt Injection 攻击模式
 *
 * 策略：检测到注入模式时，用安全标记替换并记录。
 * 不直接拒绝内容（避免误杀正常文本），而是"消毒"。
 *
 * @param content - 用户提供的原始内容
 * @returns 清洗后的内容和检测结果
 */
export function sanitizeUserContent(content: string): { sanitized: string; injectionDetected: boolean; detectedPatterns: string[] } {
  const detectedPatterns: string[] = [];
  let sanitized = content;

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      detectedPatterns.push(label);
      // 用安全标记替换（保留原文可读性但破坏注入效果）
      sanitized = sanitized.replace(pattern, (match) => `[FILTERED:${label}]`);
    }
  }

  return {
    sanitized,
    injectionDetected: detectedPatterns.length > 0,
    detectedPatterns,
  };
}

/**
 * 将字符串转为 slug（用于知识页面）
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 批量处理工具
 */
export async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await fn(batch);
    results.push(...batchResults);
  }
  return results;
}

/**
 * Hash 内容用于去重
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
