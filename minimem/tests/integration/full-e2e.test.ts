/**
 * MiniMem — 完整端到端集成测试
 * ============================================
 * 使用丰富的真实场景测试数据，从头到尾验证：
 * 1. L1-L4 四层记忆 CRUD
 * 2. 条件索引 + FTS 全文搜索
 * 3. 知识图谱（图边创建 + 遍历）
 * 4. 温度引擎（初始化/升温/衰减/分布）
 * 5. 生命周期 GC
 * 6. 知识页面 + 编译队列
 * 7. 版本控制（快照/分支/合并）
 * 8. Surface Files
 * 9. 工作模块 (tasks / daily-summary)
 * 10. 社交模块 (personas / relationships / topics)
 * 11. 链路追踪 (tracing)
 * 12. 健康监控 (health)
 * 13. 检索引擎（FTS / 条件 / enrichResults）
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { getDb } from '../../src/store/database.js';

// ── Store 层 ──
import { createExperience, createExperiencesBatch, getExperienceById, listExperiences, countExperiences } from '../../src/store/experiences.js';
import { createWorldFact, createWorldFactsBatch, getWorldFactById, findFactsBySubject, countWorldFacts } from '../../src/store/world-facts.js';
import { createObservation, getObservationById, updateObservationConfidence, countObservations } from '../../src/store/observations.js';
import { createMentalModel, getMentalModelById, getActiveMentalModels, countMentalModels } from '../../src/store/mental-models.js';
import { addConditionIndex, lookupByCondition, lookupByPrefix, addToFts, searchFts } from '../../src/store/indexes.js';
import { createLink, getOutboundLinks, getInboundLinks, traverseGraph } from '../../src/store/graph.js';
import { createKnowledgePage, getKnowledgePageById, searchKnowledgePages, getAllKnowledgePages, countKnowledgePages } from '../../src/store/knowledge-pages/page-store.js';
import { enqueueCompile, getPendingCompileItems, markCompiled, countPendingCompile } from '../../src/store/knowledge-pages/compile-queue.js';

// ── 生命周期 ──
import { initTemperature, recordAccess, decayTemperatures, getTemperatureDistribution, pinMemory, runLightGC, runStandardGC } from '../../src/lifecycle/index.js';

// ── 版本控制 ──
import { createSnapshot, listSnapshots, getLatestSnapshot } from '../../src/version/snapshot.js';
import { createBranch, getBranch, listBranches, deactivateBranch } from '../../src/version/branch.js';

// ── Surface Files ──
import { getSurfaceFile, updateSurfaceFile, getSurfaceStats } from '../../src/surface/index.js';

// ── 工作模块 ──
import { createTask, getTaskById, updateTask, deleteTask, listTasks, getTaskStats, linkMemoryToTask } from '../../src/modules/work/tasks.js';

// ── 社交模块 ──
import { getRelationships, addRelationship, getSocialNetworkOverview } from '../../src/modules/social/relationships.js';
import { getTopicTrends, getPersonTopics, getTopicDetails } from '../../src/modules/social/topic-tracker.js';

// ── Owner ──
import { createPerson, findPersonByName, getPersonById, listPersons, updatePerson, appendPersonInfo } from '../../src/owner/persons.js';

// ── 可观测性 ──
import { createTrace, startSpan, endSpan, flushTrace, getMemoryTraces } from '../../src/common/tracing.js';
import { checkHealth } from '../../src/lifecycle/health.js';

// ── 检索引擎 ──
import { enrichResults } from '../../src/retrieval/search.js';
import type { MemoryLayer } from '../../src/common/types.js';

// ═══════════════════════════════════════════════════════════
// 测试数据工厂
// ═══════════════════════════════════════════════════════════

/** 模拟的对话记录 */
const CONVERSATIONS = [
  { content: 'Alice 告诉我她下周一要去东京出差，会在那里待一周左右，主要是参加 React Asia 2026 大会', source: 'codebuddy', importance: 0.8, participants: ['Alice'], tags: ['travel', 'conference', 'react'] },
  { content: 'Bob 说他正在用 Rust 重写公司的核心推荐引擎，预计下个月完成，性能提升了 3 倍', source: 'codebuddy', importance: 0.9, participants: ['Bob'], tags: ['rust', 'performance', 'recommendation'] },
  { content: '今天和 Charlie 讨论了 MiniMem 的架构设计，他建议用 SQLite 做主存储，搭配内存向量索引', source: 'codebuddy', importance: 0.85, participants: ['Charlie'], tags: ['architecture', 'database', 'minimem'] },
  { content: 'Alice 和 Bob 一起来参加了代码评审，讨论了微服务拆分策略', source: 'codebuddy', importance: 0.7, participants: ['Alice', 'Bob'], tags: ['code-review', 'microservices'] },
  { content: '下午和 Diana 喝咖啡，她分享了最近在学习 Transformer 架构的心得', source: 'openclaw', importance: 0.6, participants: ['Diana'], tags: ['ai', 'transformer', 'learning'] },
  { content: 'Charlie 推荐了一本书《Designing Data-Intensive Applications》，说是分布式系统的圣经', source: 'codebuddy', importance: 0.7, participants: ['Charlie'], tags: ['book', 'distributed-systems'] },
  { content: '团队周会上 Alice 提到她在东京的演讲主题是关于 Server Components 的最佳实践', source: 'codebuddy', importance: 0.75, participants: ['Alice'], tags: ['meeting', 'react', 'server-components'] },
  { content: 'Bob 分享了一个 Rust 内存安全的小技巧，关于如何避免 borrow checker 的常见陷阱', source: 'codebuddy', importance: 0.65, participants: ['Bob'], tags: ['rust', 'tips'] },
  { content: '和 Eve 讨论了 AI Agent 的安全性问题，包括提示注入、权限边界、审计日志', source: 'openclaw', importance: 0.85, participants: ['Eve'], tags: ['ai-safety', 'agent', 'security'] },
  { content: 'Alice 从东京回来了，带了抹茶点心，说大会上认识了 React 核心团队的 Dan', source: 'codebuddy', importance: 0.6, participants: ['Alice'], tags: ['travel', 'social', 'react'] },
];

/** 模拟的工作任务 */
const WORK_TASKS = [
  { title: '完成 MiniMem 四层存储设计', description: 'L1 经历 → L2 事实 → L3 观察 → L4 心智模型的完整实现', status: 'done' as const, priority_score: 9 },
  { title: '实现检索引擎六路并行搜索', description: '语义/FTS/图/时间/条件/知识页面六种检索策略', status: 'done' as const, priority_score: 8 },
  { title: '实现做梦引擎四阶段流水线', description: 'Phase1 审计 → Phase2 编译 → Phase3 REM → Phase4 清理', status: 'in_progress' as const, priority_score: 9 },
  { title: '编写端到端测试', description: '使用真实场景数据验证所有功能模块', status: 'in_progress' as const, priority_score: 7 },
  { title: '对接阿里云百炼 LLM', description: '集成 DashScope API 用于事实提取和摘要生成', status: 'todo' as const, priority_score: 6 },
  { title: '性能优化：向量检索', description: '考虑引入 HNSW 索引加速 Top-K 检索', status: 'todo' as const, priority_score: 5 },
];

/** 模拟的知识页面 */
const KNOWLEDGE_PAGES = [
  { title: 'Alice Chen', slug: 'alice-chen', page_type: 'person' as const, content: '# Alice Chen\n\nReact 前端工程师，经常参加技术大会。\n\n## 关键事实\n- 去过东京参加 React Asia 2026\n- 擅长 Server Components\n- 认识 React 核心团队的 Dan\n\n## 兴趣\n- 前端架构、React 生态、旅行', confidence: 0.85 },
  { title: 'Bob Wang', slug: 'bob-wang', page_type: 'person' as const, content: '# Bob Wang\n\n系统工程师，正在用 Rust 重写推荐引擎。\n\n## 关键事实\n- Rust 专家，关注性能优化\n- 参与代码评审，关注微服务架构\n\n## 技术栈\nRust, 分布式系统, 推荐系统', confidence: 0.8 },
  { title: 'MiniMem 架构', slug: 'minimem-architecture', page_type: 'project' as const, content: '# MiniMem 架构\n\n个人统一记忆系统。\n\n## 技术选型\n- 存储：SQLite (better-sqlite3)\n- 向量：内存 HNSW 索引\n- API：MCP Server + REST (Hono)\n\n## 四层架构\nL1 经历 → L2 事实 → L3 观察 → L4 心智模型\n\n## 做梦引擎\n四阶段：审计 → 编译 → REM 联想 → 清理', confidence: 0.9 },
  { title: 'Rust 语言', slug: 'rust-lang', page_type: 'topic' as const, content: '# Rust\n\n系统编程语言，以内存安全著称。\n\n## 团队中的 Rust 用户\n- [[bob-wang]] 正在用 Rust 重写推荐引擎\n\n## 常见话题\n- borrow checker, ownership, lifetime\n- 性能优化（3x 提升）', confidence: 0.75 },
];

// ═══════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════

describe('MiniMem Full E2E Integration', () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());

  // 使用单个长测试流，保持数据上下文连贯
  // 但按照功能模块组织成子 describe

  describe('Phase 1: L1 经历写入与查询', () => {
    beforeEach(() => clearAllTables());

    it('should batch-create conversations and verify', () => {
      const inputs = CONVERSATIONS.map(c => ({
        raw_content: c.content,
        content_type: 'conversation' as const,
        source: c.source,
        importance: c.importance,
        tags: c.tags,
        participants: c.participants,
      }));

      const experiences = createExperiencesBatch(inputs);
      expect(experiences).toHaveLength(10);

      // 每条都有唯一 ID
      const ids = new Set(experiences.map(e => e.id));
      expect(ids.size).toBe(10);

      // 验证第一条
      const first = getExperienceById(experiences[0].id);
      expect(first).not.toBeNull();
      expect(first!.raw_content).toContain('Alice');
      expect(first!.raw_content).toContain('东京');
      expect(first!.participants).toContain('Alice');
      expect(first!.tags).toContain('travel');
      expect(first!.importance).toBe(0.8);
      expect(first!.branch).toBe('main');

      // 分页列表
      const page1 = listExperiences({ page: 1, page_size: 5 });
      expect(page1.items).toHaveLength(5);
      expect(page1.total).toBe(10);
      expect(page1.has_more).toBe(true);

      const page2 = listExperiences({ page: 2, page_size: 5 });
      expect(page2.items).toHaveLength(5);
      expect(page2.has_more).toBe(false);

      // 按 source 筛选
      const codebuddyOnly = listExperiences({ page: 1, page_size: 20, source: 'codebuddy' });
      expect(codebuddyOnly.total).toBe(8);
      const openclawOnly = listExperiences({ page: 1, page_size: 20, source: 'openclaw' });
      expect(openclawOnly.total).toBe(2);

      // 计数
      expect(countExperiences()).toBe(10);
    });

    it('should handle single experience creation', () => {
      const exp = createExperience({
        raw_content: '独立创建的一条测试记忆',
        source: 'test',
        importance: 0.5,
      });
      expect(exp.id).toBeTruthy();
      expect(exp.content_type).toBe('conversation'); // 默认值
      expect(exp.tags).toEqual([]);
      expect(exp.participants).toEqual([]);
    });
  });

  describe('Phase 2: L2 事实提取与验证', () => {
    beforeEach(() => clearAllTables());

    it('should create facts and verify relationships', () => {
      // 先创建 L1 经历
      const exp1 = createExperience({
        raw_content: CONVERSATIONS[0].content,
        source: 'codebuddy',
        importance: 0.8,
        participants: ['Alice'],
      });
      const exp2 = createExperience({
        raw_content: CONVERSATIONS[1].content,
        source: 'codebuddy',
        importance: 0.9,
        participants: ['Bob'],
      });

      // 提取 L2 事实
      const facts = createWorldFactsBatch([
        {
          subject: 'Alice',
          predicate: '将出差到',
          object: '东京',
          confidence: 0.9,
          valid_from: '2026-04-14',
          valid_until: '2026-04-21',
          evidence_experience_ids: [exp1.id],
          condition_keys: ['person:alice', 'place:东京', 'event:react-asia-2026'],
          source: 'codebuddy',
        },
        {
          subject: 'Alice',
          predicate: '将参加',
          object: 'React Asia 2026 大会',
          confidence: 0.85,
          evidence_experience_ids: [exp1.id],
          condition_keys: ['person:alice', 'topic:react'],
          source: 'codebuddy',
        },
        {
          subject: 'Bob',
          predicate: '正在用 Rust 重写',
          object: '推荐引擎',
          confidence: 0.95,
          evidence_experience_ids: [exp2.id],
          condition_keys: ['person:bob', 'topic:rust', 'topic:recommendation'],
          source: 'codebuddy',
        },
        {
          subject: '推荐引擎',
          predicate: '性能提升',
          object: '3 倍',
          confidence: 0.8,
          evidence_experience_ids: [exp2.id],
          condition_keys: ['topic:performance'],
          source: 'codebuddy',
        },
      ]);

      expect(facts).toHaveLength(4);
      expect(countWorldFacts()).toBe(4);

      // 验证事实内容
      const aliceFacts = findFactsBySubject('Alice');
      expect(aliceFacts).toHaveLength(2);
      expect(aliceFacts[0].confidence).toBeGreaterThanOrEqual(aliceFacts[1].confidence); // 按置信度排序

      // 验证证据链
      const fact1 = getWorldFactById(facts[0].id)!;
      expect(fact1.evidence_experience_ids).toContain(exp1.id);
      expect(fact1.condition_keys).toContain('person:alice');
    });
  });

  describe('Phase 3: L3 观察 + L4 心智模型', () => {
    beforeEach(() => clearAllTables());

    it('should create observations with confidence tracking', () => {
      const obs = createObservation({
        description: 'Alice 经常参加技术大会，是团队中最活跃的社交者',
        observation_type: 'pattern',
        confidence: 0.7,
        tags: ['social', 'conference'],
      });

      expect(obs.id).toBeTruthy();
      expect(obs.observation_type).toBe('pattern');
      expect(obs.confidence).toBe(0.7);
      expect(obs.confidence_history).toHaveLength(1);
      expect(obs.confidence_history[0].value).toBe(0.7);

      // 更新置信度
      updateObservationConfidence(obs.id, 0.85);
      const updated = getObservationById(obs.id)!;
      expect(updated.confidence).toBe(0.85);
      expect(updated.confidence_history).toHaveLength(2);
      expect(updated.confidence_history[1].value).toBe(0.85);

      expect(countObservations()).toBe(1);
    });

    it('should create mental models with priority', () => {
      const model1 = createMentalModel({
        title: '技术团队沟通模式',
        content: '团队成员倾向于在代码评审中深度讨论架构决策。非正式交流（如喝咖啡）也是重要的知识传播渠道。',
        model_type: 'principle',
        priority: 8,
        scope: 'work',
      });

      const model2 = createMentalModel({
        title: 'Rust 适合性能关键路径',
        content: '当系统的核心路径需要极致性能时，Rust 是一个好选择。Bob 的推荐引擎重写案例证明了这一点。',
        model_type: 'heuristic',
        priority: 6,
        scope: 'tech',
      });

      expect(model1.is_active).toBe(true);
      expect(model1.priority).toBe(8);
      expect(model2.model_type).toBe('heuristic');

      const activeModels = getActiveMentalModels();
      expect(activeModels).toHaveLength(2);
      expect(activeModels[0].priority).toBeGreaterThanOrEqual(activeModels[1].priority); // 按优先级排序

      expect(countMentalModels()).toBe(2);
    });
  });

  describe('Phase 4: 条件索引 + FTS 全文搜索', () => {
    beforeEach(() => clearAllTables());

    it('should support condition index lookup', () => {
      const exp = createExperience({
        raw_content: CONVERSATIONS[0].content,
        source: 'codebuddy',
        importance: 0.8,
      });

      // 创建条件索引
      addConditionIndex('person:alice', 'L1', exp.id);
      addConditionIndex('place:东京', 'L1', exp.id);
      addConditionIndex('topic:react', 'L1', exp.id);

      // 精确查找
      const aliceMemories = lookupByCondition('person:alice');
      expect(aliceMemories).toHaveLength(1);
      expect(aliceMemories[0].memory_id).toBe(exp.id);
      expect(aliceMemories[0].memory_type).toBe('L1');

      // 前缀查找
      const allPersons = lookupByPrefix('person:');
      expect(allPersons).toHaveLength(1);

      const allTopics = lookupByPrefix('topic:');
      expect(allTopics).toHaveLength(1);
    });

    it('should support FTS5 full-text search', () => {
      const exp1 = createExperience({
        raw_content: CONVERSATIONS[0].content, // Alice + React Asia
        source: 'codebuddy',
      });
      const exp2 = createExperience({
        raw_content: CONVERSATIONS[1].content, // Bob + Rust
        source: 'codebuddy',
      });

      // 添加到 FTS 索引（FTS5 unicode61 分词器对英文友好，中文需完整匹配）
      addToFts(exp1.id, 'L1', CONVERSATIONS[0].content, ['travel', 'conference', 'react'], ['person:alice']);
      addToFts(exp2.id, 'L1', CONVERSATIONS[1].content, ['rust', 'performance'], ['person:bob']);

      // 搜索英文关键词
      const rustResults = searchFts('Rust', 10);
      expect(rustResults.length).toBeGreaterThanOrEqual(1);
      expect(rustResults[0].memory_id).toBe(exp2.id);

      // 搜索 Alice（人名）
      const aliceResults = searchFts('Alice', 10);
      expect(aliceResults.length).toBeGreaterThanOrEqual(1);
      expect(aliceResults[0].memory_id).toBe(exp1.id);

      // 搜索标签
      const travelResults = searchFts('travel', 10);
      expect(travelResults.length).toBeGreaterThanOrEqual(1);

      // 搜索 React（出现在 exp1 的内容和标签中）
      const reactResults = searchFts('react', 10);
      expect(reactResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Phase 5: 知识图谱', () => {
    beforeEach(() => clearAllTables());

    it('should create and traverse graph', () => {
      const exp1 = createExperience({ raw_content: CONVERSATIONS[0].content, source: 'codebuddy' });
      const fact1 = createWorldFact({
        subject: 'Alice', predicate: '将出差到', object: '东京',
        confidence: 0.9, evidence_experience_ids: [exp1.id],
        source: 'codebuddy',
      });

      const exp2 = createExperience({ raw_content: CONVERSATIONS[1].content, source: 'codebuddy' });
      const fact2 = createWorldFact({
        subject: 'Bob', predicate: '正在重写', object: '推荐引擎',
        confidence: 0.95, evidence_experience_ids: [exp2.id],
        source: 'codebuddy',
      });

      const exp3 = createExperience({ raw_content: CONVERSATIONS[3].content, source: 'codebuddy' });

      // 创建图边
      const link1 = createLink(fact1.id, 'L2', exp1.id, 'L1', 'derived_from', 0.9);
      const link2 = createLink(fact2.id, 'L2', exp2.id, 'L1', 'derived_from', 0.9);
      const link3 = createLink(exp3.id, 'L1', exp1.id, 'L1', 'related', 0.6); // Alice 和 Bob 一起评审
      const link4 = createLink(exp3.id, 'L1', exp2.id, 'L1', 'related', 0.6);

      // 验证边
      const outbound = getOutboundLinks(fact1.id);
      expect(outbound).toHaveLength(1);
      expect(outbound[0].target_id).toBe(exp1.id);
      expect(outbound[0].link_type).toBe('derived_from');

      const inbound = getInboundLinks(exp1.id);
      expect(inbound.length).toBeGreaterThanOrEqual(1);

      // 图遍历（2 跳）
      const traversed = traverseGraph(fact1.id, 2, 50);
      expect(traversed.length).toBeGreaterThanOrEqual(1);
      // 通过 exp1 → exp3 → exp2 → fact2 可以到达 Bob 的事实
    });
  });

  describe('Phase 6: 温度引擎', () => {
    beforeEach(() => clearAllTables());

    it('should manage memory temperature lifecycle', () => {
      const exp1 = createExperience({ raw_content: CONVERSATIONS[0].content, source: 'codebuddy', importance: 0.8 });
      const exp2 = createExperience({ raw_content: CONVERSATIONS[4].content, source: 'openclaw', importance: 0.3 });

      // 初始化温度
      initTemperature(exp1.id, 'L1', 0.8); // 高重要度 → 分数 = 0.8*100+20 = 100
      initTemperature(exp2.id, 'L1', 0.3); // 低重要度 → 分数 = 0.3*100+20 = 50

      // 检查分布
      let dist = getTemperatureDistribution();
      expect(dist.hot).toBe(1);      // exp1: score=100 → hot
      expect(dist.cool).toBe(1);     // exp2: score=50 → cool

      // 记录访问（升温）
      recordAccess(exp2.id, 'L1'); // +5 → 55
      recordAccess(exp2.id, 'L1'); // +5 → 60
      recordAccess(exp2.id, 'L1'); // +5 → 65

      dist = getTemperatureDistribution();
      expect(dist.warm).toBe(1); // exp2: 65 → warm

      // 衰减
      decayTemperatures(10);
      dist = getTemperatureDistribution();
      // exp1: 100 → 90 → still hot
      // exp2: 65 → 55 → cool
      expect(dist.hot).toBe(1);
      expect(dist.cool).toBe(1);

      // 置顶测试
      pinMemory(exp2.id, 'L1', true);

      // 再次衰减 — 置顶的不受影响
      decayTemperatures(50);
      const db = getDb();
      const pinnedRow = db.prepare('SELECT score FROM memory_temperature WHERE memory_id = ?').get(exp2.id) as { score: number };
      expect(pinnedRow.score).toBe(55); // 置顶后未再衰减
    });
  });

  describe('Phase 7: 知识页面 + 编译队列', () => {
    beforeEach(() => clearAllTables());

    it('should manage knowledge pages CRUD', () => {
      const pages = KNOWLEDGE_PAGES.map(p => createKnowledgePage(p));
      expect(pages).toHaveLength(4);
      expect(countKnowledgePages()).toBe(4);

      // 按 ID 获取
      const alicePage = getKnowledgePageById(pages[0].id)!;
      expect(alicePage.title).toBe('Alice Chen');
      expect(alicePage.page_type).toBe('person');
      expect(alicePage.slug).toBe('alice-chen');
      expect(alicePage.lint_status).toBe('healthy');
      expect(alicePage.confidence).toBe(0.85);
      expect(alicePage.compile_count).toBe(1);

      // 搜索
      const results = searchKnowledgePages('Rust', 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.title === 'Rust 语言')).toBe(true);

      // 获取所有
      const all = getAllKnowledgePages();
      expect(all).toHaveLength(4);
    });

    it('should manage compile queue', () => {
      // 入队
      const item1 = enqueueCompile('query_insight', '跨域洞察：Alice 和 React 的关联', undefined, 5);
      const item2 = enqueueCompile('lint_finding', '页面 alice-chen 可能过时', 'alice-chen', 3);
      const item3 = enqueueCompile('feedback', '用户询问了 Bob 的 Rust 项目进度', 'bob-wang', 7);

      expect(item1.status).toBe('pending');
      expect(countPendingCompile()).toBe(3);

      // 获取待处理（按优先级排序）
      const pending = getPendingCompileItems(10);
      expect(pending).toHaveLength(3);
      expect(pending[0].priority).toBeGreaterThanOrEqual(pending[1].priority); // 优先级降序

      // 标记已处理
      markCompiled(item1.id);
      expect(countPendingCompile()).toBe(2);
    });
  });

  describe('Phase 8: 版本控制', () => {
    beforeEach(() => clearAllTables());

    it('should create snapshots and branches', () => {
      // 准备一些数据
      createExperience({ raw_content: '快照前的记忆', source: 'test', importance: 0.5 });
      createWorldFact({
        subject: 'Test', predicate: 'is', object: 'working',
        confidence: 0.9, evidence_experience_ids: [],
        source: 'test',
      });

      // 创建快照
      const snap1 = createSnapshot({ label: 'test-snap-1', trigger: 'manual' });
      expect(snap1.label).toBe('test-snap-1');
      expect(snap1.stats_l1).toBe(1);
      expect(snap1.stats_l2).toBe(1);
      expect(snap1.branch).toBe('main');

      // 列出快照
      const snaps = listSnapshots('main');
      expect(snaps.length).toBeGreaterThanOrEqual(1);

      // 最新快照
      const latest = getLatestSnapshot('main');
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(snap1.id);

      // 创建分支
      const dreamBranch = createBranch('dream-test', snap1.id);
      expect(dreamBranch.name).toBe('dream-test');
      expect(dreamBranch.is_active).toBe(true);

      // 验证分支
      const branch = getBranch('dream-test');
      expect(branch).not.toBeNull();
      expect(branch!.created_from_snapshot).toBe(snap1.id);

      // 列出分支
      const branches = listBranches();
      expect(branches.length).toBeGreaterThanOrEqual(2); // main + dream-test

      // 停用分支
      deactivateBranch('dream-test');
      const deactivated = getBranch('dream-test');
      expect(deactivated!.is_active).toBe(false);
    });
  });

  describe('Phase 9: Surface Files', () => {
    beforeEach(() => {
      // Surface files 有种子数据，不清空
    });

    it('should manage surface files', () => {
      // 获取现有文件
      const meFile = getSurfaceFile('me.md');
      expect(meFile).not.toBeNull();
      expect(meFile!.file_name).toBe('me.md');

      // 更新文件
      updateSurfaceFile('me.md', '# 关于我\n\n我是一个热爱技术的开发者，擅长全栈开发。\n\n## 近况\n正在开发 MiniMem 个人记忆系统。', '集成测试更新');

      const updated = getSurfaceFile('me.md')!;
      expect(updated.content).toContain('MiniMem');
      expect(updated.version).toBeGreaterThan(meFile!.version);

      // 检查统计
      const stats = getSurfaceStats();
      expect(stats.total_tokens).toBeGreaterThanOrEqual(0);
      expect(stats.files).toHaveProperty('me.md');
    });
  });

  describe('Phase 10: 工作模块', () => {
    beforeEach(() => clearAllTables());

    it('should manage work tasks CRUD', () => {
      // 批量创建任务
      const tasks = WORK_TASKS.map(t => createTask(t));
      expect(tasks).toHaveLength(6);

      // 验证任务
      const task = getTaskById(tasks[0].id)!;
      expect(task.title).toBe('完成 MiniMem 四层存储设计');
      expect(task.status).toBe('done');
      expect(task.priority_score).toBe(9);

      // 更新任务
      const updated = updateTask(tasks[2].id, { status: 'done' });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('done');

      // 删除任务
      expect(deleteTask(tasks[5].id)).toBe(true);

      // 列表（分页）
      const list = listTasks({ page: 1, page_size: 10 });
      expect(list.total).toBe(5); // 删了 1 个

      // 按状态筛选
      const doneOnly = listTasks({ page: 1, page_size: 10 }, 'done');
      expect(doneOnly.total).toBe(3); // 2 原始 done + 1 更新为 done

      // 统计
      const stats = getTaskStats();
      expect(stats.done).toBe(3);
      expect(stats.in_progress).toBe(1);
      expect(stats.todo).toBe(1);

      // 关联记忆
      const exp = createExperience({ raw_content: '讨论了做梦引擎的设计', source: 'test' });
      linkMemoryToTask(tasks[2].id, exp.id);
      const withMemory = getTaskById(tasks[2].id)!;
      expect(withMemory.linked_memories).toContain(exp.id);
    });
  });

  describe('Phase 11: 社交模块', () => {
    beforeEach(() => clearAllTables());

    it('should manage person profiles', () => {
      // 创建人设
      const alice = createPerson({
        name: 'Alice',
        aliases: ['Alice Chen', '爱丽丝'],
        personality: '外向、热情、好学',
        interests: ['React', '旅行', '技术大会'],
        opinions: { 'Server Components': '非常看好', '微服务': '需要权衡' },
        speech_patterns: ['经常说「这个很有趣」'],
      });

      expect(alice.name).toBe('Alice');
      expect(alice.interests).toContain('React');
      expect(alice.aliases).toContain('Alice Chen');

      // 按名称查找
      const found = findPersonByName('Alice');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(alice.id);

      // 别名查找
      const byAlias = findPersonByName('Alice Chen');
      expect(byAlias).not.toBeNull();
      expect(byAlias!.id).toBe(alice.id);

      // 追加信息
      const appended = appendPersonInfo(alice.id, {
        interests: ['Server Components', '日本旅行'],
        opinions: { 'TypeScript': '必须使用' },
      });
      expect(appended!.interests).toContain('Server Components');
      expect(appended!.interests).toContain('React'); // 保留原有
      expect(appended!.opinions['TypeScript']).toBe('必须使用');

      // 更新
      updatePerson(alice.id, { personality: '外向、热情、好学、组织力强' });
      const updated = getPersonById(alice.id)!;
      expect(updated.personality).toContain('组织力强');

      // 列表
      const persons = listPersons();
      expect(persons).toHaveLength(1);
    });

    it('should manage relationships and social network', () => {
      // 创建多个人设
      const alice = createPerson({ name: 'Alice', interests: ['React'] });
      const bob = createPerson({ name: 'Bob', interests: ['Rust'] });
      const charlie = createPerson({ name: 'Charlie', interests: ['架构设计'] });

      // 添加关系
      addRelationship('Alice', 'Bob', 'colleague', '同事，经常一起做代码评审');
      addRelationship('Alice', 'Charlie', 'friend', '好朋友');
      addRelationship('Bob', 'Charlie', 'colleague');

      // 查询关系
      const aliceRels = getRelationships('Alice');
      expect(aliceRels).toHaveLength(2);
      expect(aliceRels.some(r => r.person_b === 'Bob')).toBe(true);
      expect(aliceRels.some(r => r.person_b === 'Charlie')).toBe(true);

      // 社交网络概览
      const overview = getSocialNetworkOverview();
      expect(overview.people).toBe(3);
      expect(overview.relationships).toBeGreaterThanOrEqual(1); // 至少有关系
      expect(overview.mostConnected.length).toBeGreaterThanOrEqual(1);
    });

    it('should track topics with condition index', () => {
      // 先插入一些带 topic 条件索引的数据
      const exp1 = createExperience({ raw_content: CONVERSATIONS[1].content, source: 'codebuddy' });
      const exp2 = createExperience({ raw_content: CONVERSATIONS[7].content, source: 'codebuddy' });
      const exp3 = createExperience({ raw_content: CONVERSATIONS[2].content, source: 'codebuddy' });

      addConditionIndex('topic:rust', 'L1', exp1.id);
      addConditionIndex('person:bob', 'L1', exp1.id);
      addConditionIndex('topic:rust', 'L1', exp2.id);
      addConditionIndex('person:bob', 'L1', exp2.id);
      addConditionIndex('topic:architecture', 'L1', exp3.id);
      addConditionIndex('person:charlie', 'L1', exp3.id);

      // 话题趋势
      const trends = getTopicTrends(30, 10);
      expect(trends.length).toBeGreaterThanOrEqual(1);

      const rustTopic = trends.find(t => t.topic === 'rust');
      expect(rustTopic).toBeDefined();
      expect(rustTopic!.mention_count).toBe(2);

      // 人物相关话题
      const bobTopics = getPersonTopics('bob');
      expect(bobTopics.length).toBeGreaterThanOrEqual(1);
      expect(bobTopics.some(t => t.topic === 'rust')).toBe(true);

      // 话题详情
      const rustDetails = getTopicDetails('rust');
      expect(rustDetails.topic).toBe('rust');
      expect(rustDetails.memories.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Phase 12: 链路追踪', () => {
    beforeEach(() => clearAllTables());

    it('should create and flush traces', () => {
      const exp = createExperience({ raw_content: '用于追踪测试的记忆', source: 'test' });

      // 创建追踪
      const trace = createTrace();
      expect(trace.trace_id).toBeTruthy();

      // 开始 span
      const span1 = startSpan(trace, 'ingest', 'intake', exp.id, 'L1');
      expect(span1.span_name).toBe('ingest');
      endSpan(span1, 'success', { tokens: 50 });
      expect(span1.result).toBe('success');
      expect(span1.ended_at).toBeDefined();

      const span2 = startSpan(trace, 'index', 'processing', exp.id, 'L1');
      endSpan(span2, 'success', { indexed_to: 'fts5' });

      const span3 = startSpan(trace, 'embed', 'processing', exp.id, 'L1');
      endSpan(span3, 'skip', { reason: 'LLM not available' });

      // 写入数据库
      flushTrace(trace);

      // 查询追踪
      const traces = getMemoryTraces(exp.id);
      expect(traces).toHaveLength(3);
      expect(traces.some(t => t.span_name === 'ingest')).toBe(true);
      expect(traces.some(t => t.span_name === 'embed' && t.result === 'skip')).toBe(true);
    });
  });

  describe('Phase 13: GC 与健康监控', () => {
    beforeEach(() => clearAllTables());

    it('should run light GC', () => {
      // 创建一些记忆和温度
      for (let i = 0; i < 5; i++) {
        const exp = createExperience({
          raw_content: `测试记忆 #${i}`,
          source: 'test',
          importance: i < 2 ? 0.1 : 0.7,
        });
        initTemperature(exp.id, 'L1', i < 2 ? 0.1 : 0.7);
      }

      const result = runLightGC();
      expect(result.gc_type).toBe('light');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);

      // 检查 gc_log 是否写入
      const db = getDb();
      const gcLogs = db.prepare('SELECT * FROM gc_log').all();
      expect(gcLogs.length).toBeGreaterThanOrEqual(1);
    });

    it('should run standard GC', () => {
      for (let i = 0; i < 3; i++) {
        const exp = createExperience({
          raw_content: `标准 GC 测试 #${i}`,
          source: 'test',
          importance: 0.5,
        });
        initTemperature(exp.id, 'L1', 0.5);
      }

      const result = runStandardGC();
      expect(result.gc_type).toBe('standard');
    });

    it('should produce health report', () => {
      // 准备各层数据
      createExperience({ raw_content: 'L1 for health', source: 'test' });
      createWorldFact({ subject: 'Test', predicate: 'is', object: 'good', confidence: 0.9, evidence_experience_ids: [], source: 'test' });
      createObservation({ description: 'Test observation', observation_type: 'pattern' });
      createMentalModel({ title: 'Test Model', content: 'Test content' });
      createKnowledgePage({ title: 'Test Page', content: 'Test page content' });

      const report = checkHealth();

      expect(report.layers.L1).toBe(1);
      expect(report.layers.L2).toBe(1);
      expect(report.layers.L3).toBe(1);
      expect(report.layers.L4).toBe(1);
      expect(report.layers.knowledge_pages).toBe(1);
      expect(report.status).toBeDefined();
      expect(report.checked_at).toBeTruthy();
      expect(report.storage.total_memories).toBe(4); // L1+L2+L3+L4
    });
  });

  describe('Phase 14: 检索引擎 enrichResults', () => {
    beforeEach(() => clearAllTables());

    it('should enrich results from all layers', () => {
      // 创建各层数据
      const exp = createExperience({ raw_content: 'Alice 在东京参加了 React 大会', source: 'test', importance: 0.8 });
      const fact = createWorldFact({
        subject: 'Alice', predicate: '参加', object: 'React Asia 2026',
        confidence: 0.9, evidence_experience_ids: [exp.id], source: 'test',
      });
      const obs = createObservation({ description: 'Alice 经常参加技术大会', observation_type: 'pattern' });
      const model = createMentalModel({ title: '技术社交模式', content: '参加大会是建立人脉的好方式' });

      // enrichResults 补全内容
      const results = enrichResults([
        { id: exp.id, layer: 'L1' as MemoryLayer, content: '', score: 0.8, source_strategy: 'keyword', metadata: {} },
        { id: fact.id, layer: 'L2' as MemoryLayer, content: '', score: 0.9, source_strategy: 'condition', metadata: {} },
        { id: obs.id, layer: 'L3' as MemoryLayer, content: '', score: 0.7, source_strategy: 'semantic', metadata: {} },
        { id: model.id, layer: 'L4' as MemoryLayer, content: '', score: 0.85, source_strategy: 'keyword', metadata: {} },
      ]);

      expect(results[0].content).toContain('Alice');
      expect(results[0].content).toContain('东京');

      expect(results[1].content).toContain('Alice');
      expect(results[1].content).toContain('参加');
      expect(results[1].content).toContain('React Asia 2026');

      expect(results[2].content).toContain('Alice 经常参加技术大会');

      expect(results[3].content).toContain('技术社交模式');
      expect(results[3].content).toContain('参加大会是建立人脉的好方式');
    });
  });

  describe('Phase 15: 综合端到端流程', () => {
    beforeEach(() => clearAllTables());

    it('should complete full memory lifecycle: ingest → index → retrieve → enrich', () => {
      // ── Step 1: 写入一批对话 ──
      const experiences = createExperiencesBatch(
        CONVERSATIONS.map(c => ({
          raw_content: c.content,
          content_type: 'conversation' as const,
          source: c.source,
          importance: c.importance,
          tags: c.tags,
          participants: c.participants,
        }))
      );
      expect(experiences).toHaveLength(10);

      // ── Step 2: 提取事实 ──
      const facts = createWorldFactsBatch([
        { subject: 'Alice', predicate: '将出差到', object: '东京', confidence: 0.9, evidence_experience_ids: [experiences[0].id], condition_keys: ['person:alice', 'place:东京'], source: 'codebuddy' },
        { subject: 'Bob', predicate: '正在用 Rust 重写', object: '推荐引擎', confidence: 0.95, evidence_experience_ids: [experiences[1].id], condition_keys: ['person:bob', 'topic:rust'], source: 'codebuddy' },
        { subject: 'Charlie', predicate: '建议用 SQLite', object: 'MiniMem 主存储', confidence: 0.85, evidence_experience_ids: [experiences[2].id], condition_keys: ['person:charlie', 'topic:architecture'], source: 'codebuddy' },
      ]);

      // ── Step 3: 建立索引 ──
      for (const exp of experiences) {
        const conv = CONVERSATIONS[experiences.indexOf(exp)];
        if (!conv) continue;
        addToFts(exp.id, 'L1', conv.content, conv.tags, conv.participants.map(p => `person:${p.toLowerCase()}`));
        for (const p of conv.participants) addConditionIndex(`person:${p.toLowerCase()}`, 'L1', exp.id);
        for (const t of conv.tags) addConditionIndex(`topic:${t}`, 'L1', exp.id);
      }

      for (const fact of facts) {
        for (const key of fact.condition_keys) {
          addConditionIndex(key, 'L2', fact.id);
        }
        addToFts(fact.id, 'L2', `${fact.subject} ${fact.predicate} ${fact.object}`, [], fact.condition_keys);
      }

      // ── Step 4: 建立图边 ──
      for (const fact of facts) {
        for (const eid of fact.evidence_experience_ids) {
          createLink(fact.id, 'L2', eid, 'L1', 'derived_from', 0.9);
        }
      }

      // ── Step 5: 创建 L3 观察 ──
      const obs = createObservation({
        description: '团队成员有明确的技术专长分工：Alice=React前端, Bob=Rust系统, Charlie=架构设计',
        observation_type: 'pattern',
        supporting_fact_ids: facts.map(f => f.id),
        confidence: 0.8,
        tags: ['team', 'specialization'],
      });

      // ── Step 6: 创建 L4 心智模型 ──
      createMentalModel({
        title: '技术团队的互补分工模型',
        content: '一个高效的技术团队需要成员在不同技术栈上有深度专长，并通过代码评审和非正式交流实现知识共享。',
        priority: 8,
      });

      // ── Step 7: 创建知识页面 ──
      KNOWLEDGE_PAGES.forEach(p => createKnowledgePage(p));

      // ── Step 8: 初始化温度 ──
      for (const exp of experiences) {
        const conv = CONVERSATIONS[experiences.indexOf(exp)];
        if (conv) initTemperature(exp.id, 'L1', conv.importance);
      }

      // ── Step 9: 快照 ──
      const snap = createSnapshot({ label: 'full-e2e-baseline', trigger: 'manual' });
      expect(snap.stats_l1).toBe(10);
      expect(snap.stats_l2).toBe(3);
      expect(snap.stats_l3).toBe(1);
      expect(snap.stats_l4).toBe(1);
      expect(snap.stats_pages).toBe(4);

      // ── Step 10: 验证检索 ──

      // FTS 搜索
      const ftsResults = searchFts('Rust', 10);
      expect(ftsResults.length).toBeGreaterThanOrEqual(1);

      // 条件索引搜索
      const aliceMemories = lookupByCondition('person:alice');
      expect(aliceMemories.length).toBeGreaterThanOrEqual(1);

      const allPeople = lookupByPrefix('person:');
      expect(allPeople.length).toBeGreaterThanOrEqual(3);

      // enrichResults
      const enriched = enrichResults(
        aliceMemories.slice(0, 3).map(m => ({
          id: m.memory_id,
          layer: m.memory_type as MemoryLayer,
          content: '',
          score: 0.9,
          source_strategy: 'condition',
          metadata: {},
        }))
      );
      expect(enriched.every(r => r.content.length > 0)).toBe(true);

      // ── Step 11: 创建工作任务并关联记忆 ──
      const task = createTask({
        title: '追踪 Alice 东京出差安排',
        description: '确保知道 Alice 的日程安排',
        priority_score: 7,
        due_date: '2026-04-14',
      });
      linkMemoryToTask(task.id, experiences[0].id);
      expect(getTaskById(task.id)!.linked_memories).toContain(experiences[0].id);

      // ── Step 12: 创建人设 + 关系 ──
      createPerson({ name: 'Alice', interests: ['React', '旅行'] });
      createPerson({ name: 'Bob', interests: ['Rust', '性能优化'] });
      createPerson({ name: 'Charlie', interests: ['架构设计', '分布式系统'] });

      addRelationship('Alice', 'Bob', 'colleague');
      addRelationship('Alice', 'Charlie', 'friend');

      const overview = getSocialNetworkOverview();
      expect(overview.people).toBe(3);

      // ── Step 13: 链路追踪 ──
      const trace = createTrace();
      startSpan(trace, 'e2e-ingest', 'intake', experiences[0].id, 'L1');
      endSpan(trace.spans[0], 'success');
      flushTrace(trace);

      const traceRecords = getMemoryTraces(experiences[0].id);
      expect(traceRecords).toHaveLength(1);

      // ── Step 14: 健康监控 ──
      const health = checkHealth();
      expect(health.layers.L1).toBe(10);
      expect(health.layers.L2).toBe(3);
      expect(health.layers.L3).toBe(1);
      expect(health.layers.L4).toBe(1);
      expect(health.layers.knowledge_pages).toBe(4);
      expect(health.storage.total_memories).toBe(15); // 10+3+1+1
      expect(health.status).toBeDefined();

      // ── Step 15: GC ──
      const gcResult = runLightGC();
      expect(gcResult.gc_type).toBe('light');

      // ── 最终验证：数据完整性 ──
      expect(countExperiences()).toBe(10);
      expect(countWorldFacts()).toBe(3);
      expect(countObservations()).toBe(1);
      expect(countMentalModels()).toBe(1);
      expect(countKnowledgePages()).toBe(4);
    });
  });
});
