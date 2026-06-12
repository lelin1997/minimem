// ============================================================
// MiniMem — Hint Skip Rules (MINIMEM-006 T-H02)
// ============================================================
// 对明显不需要召回的消息快速跳过，节省资源

import { getLogger } from '../common/logger.js';
import type { SkipResult } from './types.js';

const log = getLogger('recall:skip');

// ── 硬规则匹配模式 ──

/** 纯问候语 */
const GREETING_PATTERNS = /^(你好|嗨|早上好|下午好|晚上好|hi|hello|hey|good\s*(morning|afternoon|evening))[\s!！。.？?]*$/i;

/** 纯确认语 */
const CONFIRM_PATTERNS = /^(好的|确认|ok|yes|是的|嗯|对|收到|明白|了解|知道了|got\s*it|sure|alright|okay)[\s!！。.？?]*$/i;

/** 系统指令（无需历史上下文） */
const SYSTEM_CMD_PATTERNS = /^(格式化|翻译|帮我写|生成代码|format|translate|generate|refactor|lint|fix|debug)[\s]?/i;

/**
 * 判断消息是否应跳过 Hint 召回
 *
 * 快速路径：正则匹配即返回，延迟 ≤5ms
 */
export function shouldSkip(message: string, minLength: number = 10): SkipResult {
  const trimmed = message.trim();

  // 规则 1: 消息太短
  if (trimmed.length < minLength) {
    log.debug({ length: trimmed.length, minLength }, 'Skip: message too short');
    return { skip: true, reason: 'message_too_short' };
  }

  // 规则 2: 纯问候语
  if (GREETING_PATTERNS.test(trimmed)) {
    return { skip: true, reason: 'greeting' };
  }

  // 规则 3: 纯确认语
  if (CONFIRM_PATTERNS.test(trimmed)) {
    return { skip: true, reason: 'confirmation' };
  }

  // 规则 4: 系统指令
  if (SYSTEM_CMD_PATTERNS.test(trimmed)) {
    return { skip: true, reason: 'system_command' };
  }

  // 不跳过
  return { skip: false, reason: '' };
}
