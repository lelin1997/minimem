/**
 * MiniMem — LLM Prompt 模板测试
 */
import { describe, it, expect } from 'vitest';
import {
  factExtractionPrompt,
  importanceScoringPrompt,
  qualityGatePrompt,
  nerPrompt,
  knowledgePageCompilePrompt,
  queryPlannerPrompt,
} from '../../src/llm/prompts.js';

describe('Prompt Templates', () => {
  describe('factExtractionPrompt', () => {
    it('应该生成 system + user 两条消息', () => {
      const messages = factExtractionPrompt([
        { id: 'e1', content: '今天和 Alice 讨论了 TypeScript 项目' },
        { id: 'e2', content: 'Bob 推荐使用 Vitest 做测试' },
      ]);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toContain('e1');
      expect(messages[1].content).toContain('e2');
      expect(messages[1].content).toContain('Alice');
      expect(messages[0].content).toContain('三元组');
    });
  });

  describe('importanceScoringPrompt', () => {
    it('无上下文时只有内容', () => {
      const messages = importanceScoringPrompt('test content');
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain('test content');
      expect(messages[1].content).not.toContain('上下文');
    });

    it('有上下文时包含上下文', () => {
      const messages = importanceScoringPrompt('content', 'some context');
      expect(messages[1].content).toContain('上下文');
      expect(messages[1].content).toContain('some context');
    });
  });

  describe('qualityGatePrompt', () => {
    it('应该包含拒绝规则', () => {
      const messages = qualityGatePrompt('你好');
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toContain('拒绝');
      expect(messages[1].content).toBe('你好');
    });
  });

  describe('nerPrompt', () => {
    it('应该列出实体类型', () => {
      const messages = nerPrompt('Alice 在 TechCo 使用 TypeScript');
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toContain('person');
      expect(messages[0].content).toContain('technology');
      expect(messages[0].content).toContain('organization');
    });
  });

  describe('knowledgePageCompilePrompt', () => {
    it('含已有页面时正确格式化', () => {
      const messages = knowledgePageCompilePrompt(
        [{ subject: 'Alice', predicate: 'likes', object: 'TS' }],
        ['alice-chen', 'typescript-guide'],
        '# Alice Chen\nAlice 是开发者'
      );
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain('Alice');
      expect(messages[1].content).toContain('alice-chen');
      expect(messages[1].content).toContain('现有页面内容');
    });

    it('无已有页面', () => {
      const messages = knowledgePageCompilePrompt(
        [{ subject: 'X', predicate: 'Y', object: 'Z' }],
        [],
      );
      expect(messages[1].content).toContain('当前无知识页面');
    });
  });

  describe('queryPlannerPrompt', () => {
    it('无 mental models 时正常工作', () => {
      const messages = queryPlannerPrompt('什么是 TypeScript?', []);
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain('TypeScript');
      expect(messages[0].content).toContain('semantic_search');
    });

    it('有 mental models 时包含摘要', () => {
      const messages = queryPlannerPrompt('test', ['[principle] 代码质量优先: 始终优先...']);
      expect(messages[1].content).toContain('代码质量优先');
    });
  });
});
