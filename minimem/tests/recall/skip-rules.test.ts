/**
 * MiniMem — Skip Rules 单元测试 (T-H10.3)
 *
 * 测试 shouldSkip() 的各种跳过规则：
 * - 消息太短 → skip
 * - 纯问候语 → skip
 * - 纯确认语 → skip
 * - 系统指令 → skip
 * - 正常消息 → 不 skip
 * - 边界值
 */

import { describe, it, expect } from 'vitest';
import { shouldSkip } from '../../src/recall/skip-rules.js';

describe('shouldSkip — Skip Rules', () => {
  // ── 规则 1: 消息太短 ──

  describe('Rule 1: message_too_short', () => {
    it('should skip empty message', () => {
      const result = shouldSkip('');
      expect(result.skip).toBe(true);
      expect(result.reason).toBe('message_too_short');
    });

    it('should skip whitespace-only message', () => {
      const result = shouldSkip('   ');
      expect(result.skip).toBe(true);
      expect(result.reason).toBe('message_too_short');
    });

    it('should skip message shorter than default minLength (10)', () => {
      const result = shouldSkip('短消息');
      expect(result.skip).toBe(true);
      expect(result.reason).toBe('message_too_short');
    });

    it('should skip message with length exactly 9 (< 10)', () => {
      const result = shouldSkip('123456789');
      expect(result.skip).toBe(true);
      expect(result.reason).toBe('message_too_short');
    });

    it('should NOT skip message with length exactly 10 (= minLength)', () => {
      const result = shouldSkip('1234567890');
      expect(result.skip).toBe(false);
    });

    it('should respect custom minLength', () => {
      // 'hello' would match greeting pattern, use a non-matching word
      const result = shouldSkip('world', 3);
      expect(result.skip).toBe(false);
    });

    it('should skip when custom minLength is larger', () => {
      const result = shouldSkip('some text here', 20);
      expect(result.skip).toBe(true);
      expect(result.reason).toBe('message_too_short');
    });
  });

  // ── 规则 2: 纯问候语 ──

  describe('Rule 2: greeting', () => {
    const greetings = [
      '你好', '你好！', '你好。',
      '嗨', '早上好', '下午好', '晚上好',
      'hi', 'Hi!', 'hello', 'Hello!',
      'hey', 'Hey!',
      'good morning', 'Good Morning!',
      'good afternoon', 'good evening',
    ];

    for (const greeting of greetings) {
      it(`should skip greeting: "${greeting}"`, () => {
        const result = shouldSkip(greeting, 1); // minLength=1 避免被短消息规则拦截
        expect(result.skip).toBe(true);
        expect(result.reason).toBe('greeting');
      });
    }

    it('should NOT skip greeting followed by content', () => {
      const result = shouldSkip('你好，我想了解一下项目进展', 1);
      expect(result.skip).toBe(false);
    });

    it('should NOT skip partial greeting in sentence', () => {
      const result = shouldSkip('你好吗？最近过得怎么样', 1);
      expect(result.skip).toBe(false);
    });
  });

  // ── 规则 3: 纯确认语 ──

  describe('Rule 3: confirmation', () => {
    const confirmations = [
      '好的', '好的！', '确认',
      'ok', 'OK', 'Ok!',
      'yes', 'Yes!', '是的',
      '嗯', '对', '收到', '明白',
      '了解', '知道了',
      'got it', 'Got it!',
      'sure', 'Sure!',
      'alright', 'okay', 'Okay!',
    ];

    for (const confirmation of confirmations) {
      it(`should skip confirmation: "${confirmation}"`, () => {
        const result = shouldSkip(confirmation, 1);
        expect(result.skip).toBe(true);
        expect(result.reason).toBe('confirmation');
      });
    }

    it('should NOT skip confirmation with additional content', () => {
      const result = shouldSkip('好的，那我来说一下详细需求', 1);
      expect(result.skip).toBe(false);
    });
  });

  // ── 规则 4: 系统指令 ──

  describe('Rule 4: system_command', () => {
    const systemCommands = [
      '格式化代码',
      '翻译这段话',
      '帮我写一个函数',
      '生成代码来处理文件',
      'format this code',
      'translate to English',
      'generate a function',
      'refactor this class',
      'lint this file',
      'fix the bug',
      'debug this issue',
    ];

    for (const cmd of systemCommands) {
      it(`should skip system command: "${cmd}"`, () => {
        const result = shouldSkip(cmd, 1);
        expect(result.skip).toBe(true);
        expect(result.reason).toBe('system_command');
      });
    }

    it('should NOT skip when command keyword is in the middle', () => {
      const result = shouldSkip('上次你帮我生成代码的那个项目怎么样了', 1);
      expect(result.skip).toBe(false);
    });
  });

  // ── 正常消息 ──

  describe('Normal messages (should NOT skip)', () => {
    const normalMessages = [
      '我昨天和张三讨论了项目架构',
      '能帮我回忆一下上次会议的内容吗',
      '关于 TypeScript 的泛型，之前你给我讲过什么',
      'What did we discuss about the authentication module?',
      'Can you recall our conversation about Docker?',
      '最近的项目有什么进展',
    ];

    for (const msg of normalMessages) {
      it(`should NOT skip: "${msg.slice(0, 30)}..."`, () => {
        const result = shouldSkip(msg);
        expect(result.skip).toBe(false);
        expect(result.reason).toBe('');
      });
    }
  });

  // ── 边界情况 ──

  describe('Edge cases', () => {
    it('should handle message with only punctuation (short)', () => {
      const result = shouldSkip('!!!');
      expect(result.skip).toBe(true);
      expect(result.reason).toBe('message_too_short');
    });

    it('should trim leading/trailing whitespace before checking length', () => {
      const result = shouldSkip('  短  ');
      expect(result.skip).toBe(true);
      expect(result.reason).toBe('message_too_short');
    });

    it('should handle minLength = 0', () => {
      const result = shouldSkip('a', 0);
      // Even with minLength 0, non-empty message passes length check
      expect(result.skip).toBe(false);
    });
  });
});
