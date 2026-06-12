// ============================================================
// MiniMem — 数据库 Schema 定义（28 张表 + 1 虚拟表）
// ============================================================

/**
 * 所有建表 SQL，按模块分组，顺序考虑外键依赖
 */
export const SCHEMA_SQL = `

-- ═══════════════════════════════════════════════════════════
-- 核心存储：L1-L4 四层记忆
-- ═══════════════════════════════════════════════════════════

-- L1 经历（只增不改，原始记录）
CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  raw_content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'conversation',
  source TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  tags TEXT NOT NULL DEFAULT '[]',           -- JSON array
  participants TEXT NOT NULL DEFAULT '[]',   -- JSON array
  context TEXT,
  content_hash TEXT,                         -- SHA-256 去重
  embedding_id TEXT,
  snapshot_id TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  domain TEXT NOT NULL DEFAULT 'default',    -- MINIMEM-001: 领域隔离
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_experiences_source ON experiences(source);
CREATE INDEX IF NOT EXISTS idx_experiences_content_type ON experiences(content_type);
CREATE INDEX IF NOT EXISTS idx_experiences_created_at ON experiences(created_at);
CREATE INDEX IF NOT EXISTS idx_experiences_branch ON experiences(branch);
CREATE INDEX IF NOT EXISTS idx_experiences_content_hash ON experiences(content_hash);
CREATE INDEX IF NOT EXISTS idx_experiences_importance ON experiences(importance DESC);
CREATE INDEX IF NOT EXISTS idx_experiences_domain ON experiences(domain);
CREATE INDEX IF NOT EXISTS idx_experiences_domain_created ON experiences(domain, created_at);

-- L2 世界事实（三元组）
CREATE TABLE IF NOT EXISTS world_facts (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  valid_from TEXT,
  valid_until TEXT,
  evidence_experience_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of L1 IDs
  condition_keys TEXT NOT NULL DEFAULT '[]',            -- JSON array
  source TEXT NOT NULL,
  snapshot_id TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  domain TEXT NOT NULL DEFAULT 'default',    -- MINIMEM-001: 领域隔离
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_world_facts_subject ON world_facts(subject);
CREATE INDEX IF NOT EXISTS idx_world_facts_predicate ON world_facts(predicate);
CREATE INDEX IF NOT EXISTS idx_world_facts_object ON world_facts(object);
CREATE INDEX IF NOT EXISTS idx_world_facts_confidence ON world_facts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_world_facts_branch ON world_facts(branch);
CREATE INDEX IF NOT EXISTS idx_world_facts_domain ON world_facts(domain);

-- L3 观察（散点记录）
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  observation_type TEXT NOT NULL DEFAULT 'pattern',
  supporting_fact_ids TEXT NOT NULL DEFAULT '[]',      -- JSON array of L2 IDs
  contradicting_fact_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array of L2 IDs
  confidence REAL NOT NULL DEFAULT 0.6,
  confidence_history TEXT NOT NULL DEFAULT '[]',       -- JSON array
  tags TEXT NOT NULL DEFAULT '[]',
  drift_risk INTEGER NOT NULL DEFAULT 0,               -- REQ-012: 信念漂移风险标记
  snapshot_id TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  domain TEXT NOT NULL DEFAULT 'default',    -- MINIMEM-001: 领域隔离
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(observation_type);
CREATE INDEX IF NOT EXISTS idx_observations_confidence ON observations(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_observations_branch ON observations(branch);
CREATE INDEX IF NOT EXISTS idx_observations_domain ON observations(domain);
-- NOTE: idx_observations_drift_risk 在 migration v3 中创建（避免旧库升级时列不存在导致报错）

-- L4 心智模型
CREATE TABLE IF NOT EXISTS mental_models (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  model_type TEXT NOT NULL DEFAULT 'principle',
  priority INTEGER NOT NULL DEFAULT 5,               -- 1-10
  scope TEXT NOT NULL DEFAULT 'global',
  origin TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,              -- boolean
  snapshot_id TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  domain TEXT NOT NULL DEFAULT 'default',    -- MINIMEM-001: 领域隔离
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mental_models_type ON mental_models(model_type);
CREATE INDEX IF NOT EXISTS idx_mental_models_priority ON mental_models(priority DESC);
CREATE INDEX IF NOT EXISTS idx_mental_models_active ON mental_models(is_active);
CREATE INDEX IF NOT EXISTS idx_mental_models_branch ON mental_models(branch);
CREATE INDEX IF NOT EXISTS idx_mental_models_domain ON mental_models(domain);

-- 人设画像
CREATE TABLE IF NOT EXISTS person_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',                -- JSON array
  personality TEXT,
  interests TEXT NOT NULL DEFAULT '[]',              -- JSON array
  opinions TEXT NOT NULL DEFAULT '{}',               -- JSON object
  speech_patterns TEXT NOT NULL DEFAULT '[]',        -- JSON array
  relationships TEXT NOT NULL DEFAULT '[]',          -- JSON array
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_person_profiles_name ON person_profiles(name);

-- ═══════════════════════════════════════════════════════════
-- Knowledge Pages（Karpathy 编译范式）
-- ═══════════════════════════════════════════════════════════

-- L3 知识页面
CREATE TABLE IF NOT EXISTS knowledge_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'topic',
  content TEXT NOT NULL DEFAULT '',                  -- Markdown + [[backlink]]
  compile_count INTEGER NOT NULL DEFAULT 0,
  last_compiled TEXT,
  lint_status TEXT NOT NULL DEFAULT 'healthy',
  staleness_score REAL NOT NULL DEFAULT 0.0,
  confidence REAL NOT NULL DEFAULT 0.5,
  embedding_id TEXT,
  snapshot_id TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_pages_slug ON knowledge_pages(slug);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_type ON knowledge_pages(page_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_lint ON knowledge_pages(lint_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_branch ON knowledge_pages(branch);

-- 知识页面反向链接
CREATE TABLE IF NOT EXISTS knowledge_page_links (
  id TEXT PRIMARY KEY,
  from_page_id TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  link_context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kp_links_from ON knowledge_page_links(from_page_id);
CREATE INDEX IF NOT EXISTS idx_kp_links_to ON knowledge_page_links(to_page_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_links_pair ON knowledge_page_links(from_page_id, to_page_id);

-- 知识页面证据链
CREATE TABLE IF NOT EXISTS knowledge_page_evidence (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,                       -- 'l1' | 'l2' | 'l3'
  evidence_id TEXT NOT NULL,
  section_hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kp_evidence_page ON knowledge_page_evidence(page_id);
CREATE INDEX IF NOT EXISTS idx_kp_evidence_ref ON knowledge_page_evidence(evidence_type, evidence_id);

-- R-013: 知识页面版本历史
CREATE TABLE IF NOT EXISTS knowledge_page_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kp_versions_page ON knowledge_page_versions(page_id);
CREATE INDEX IF NOT EXISTS idx_kp_versions_version ON knowledge_page_versions(page_id, version DESC);

-- 编译队列
CREATE TABLE IF NOT EXISTS compile_queue (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,                         -- 'new_fact' | 'query_insight' | 'feedback' | 'lint_finding'
  content TEXT NOT NULL,
  target_page TEXT,                                  -- slug or null
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending',             -- 'pending' | 'compiled' | 'skipped'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_compile_queue_status ON compile_queue(status);
CREATE INDEX IF NOT EXISTS idx_compile_queue_priority ON compile_queue(priority DESC);

-- ═══════════════════════════════════════════════════════════
-- 接入与认证
-- ═══════════════════════════════════════════════════════════

-- 客户端注册
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_secret_hash TEXT NOT NULL,
  permission_level TEXT NOT NULL DEFAULT 'standard',
  read_layers TEXT NOT NULL DEFAULT '["L2","L3","L4"]',  -- JSON array
  can_write INTEGER NOT NULL DEFAULT 1,
  can_dream INTEGER NOT NULL DEFAULT 0,
  can_snapshot INTEGER NOT NULL DEFAULT 0,
  reads_per_minute INTEGER NOT NULL DEFAULT 20,
  writes_per_minute INTEGER NOT NULL DEFAULT 20,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Owner Profile (KV 存储)
CREATE TABLE IF NOT EXISTS owner_profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                               -- JSON
  category TEXT NOT NULL DEFAULT 'general',
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_owner_profile_category ON owner_profile(category);

-- 接入审计日志
CREATE TABLE IF NOT EXISTS access_log (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  action TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  params_summary TEXT,
  result_summary TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_access_log_client ON access_log(client_id);
CREATE INDEX IF NOT EXISTS idx_access_log_created ON access_log(created_at);

-- ═══════════════════════════════════════════════════════════
-- 版本控制
-- ═══════════════════════════════════════════════════════════

-- 快照
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main',
  trigger TEXT NOT NULL DEFAULT 'manual',
  parent_snapshot_id TEXT,
  stats_l1 INTEGER NOT NULL DEFAULT 0,
  stats_l2 INTEGER NOT NULL DEFAULT 0,
  stats_l3 INTEGER NOT NULL DEFAULT 0,
  stats_l4 INTEGER NOT NULL DEFAULT 0,
  stats_pages INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_branch ON snapshots(branch);

-- 分支
CREATE TABLE IF NOT EXISTS branches (
  name TEXT PRIMARY KEY,
  created_from_snapshot TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 变更审计
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- ═══════════════════════════════════════════════════════════
-- 索引与检索
-- ═══════════════════════════════════════════════════════════

-- 条件索引 (O(1) 查找)
CREATE TABLE IF NOT EXISTS condition_index (
  condition_key TEXT NOT NULL,                       -- e.g. "person:alice"
  memory_type TEXT NOT NULL,                         -- 'L1' | 'L2' | 'L3' | 'L4'
  memory_id TEXT NOT NULL,
  PRIMARY KEY (condition_key, memory_type, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_condition_key ON condition_index(condition_key);

-- 知识图谱（边）
CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'related',
  weight REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_memory_links_type ON memory_links(link_type);

-- FTS5 全文搜索（虚拟表）
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  memory_id,
  memory_type,
  content,
  tags,
  condition_keys,
  tokenize='unicode61'
);

-- ═══════════════════════════════════════════════════════════
-- Surface Files
-- ═══════════════════════════════════════════════════════════

-- 当前文件
CREATE TABLE IF NOT EXISTS surface_files (
  file_name TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  token_count INTEGER NOT NULL DEFAULT 0,
  budget_tokens INTEGER NOT NULL DEFAULT 1500,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 版本历史
CREATE TABLE IF NOT EXISTS surface_file_history (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sf_history_name ON surface_file_history(file_name);

-- 更新队列
CREATE TABLE IF NOT EXISTS surface_update_queue (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',            -- 'pending' | 'applied' | 'rejected'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sf_update_queue_status ON surface_update_queue(status);

-- ═══════════════════════════════════════════════════════════
-- 生命周期管理
-- ═══════════════════════════════════════════════════════════

-- 温度追踪
CREATE TABLE IF NOT EXISTS memory_temperature (
  memory_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  temperature TEXT NOT NULL DEFAULT 'hot',
  score REAL NOT NULL DEFAULT 100.0,                 -- 0-100
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  compression_level INTEGER NOT NULL DEFAULT 0,       -- 0=none, 1=summary, 2=key-points, 3=one-line
  stability REAL NOT NULL DEFAULT 24.0,               -- MINIMEM-003 E10: Ebbinghaus 稳定性（小时）
  review_count INTEGER NOT NULL DEFAULT 0,            -- MINIMEM-003 E10: 复习次数
  initial_score REAL NOT NULL DEFAULT 50.0,           -- MINIMEM-003 E10: 初始分数基准
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (memory_id, memory_type)
);

CREATE INDEX IF NOT EXISTS idx_mem_temp_temperature ON memory_temperature(temperature);
CREATE INDEX IF NOT EXISTS idx_mem_temp_score ON memory_temperature(score);
CREATE INDEX IF NOT EXISTS idx_mem_temp_pinned ON memory_temperature(pinned);

-- 已删除墓碑
CREATE TABLE IF NOT EXISTS memory_tombstones (
  id TEXT PRIMARY KEY,
  original_id TEXT NOT NULL,
  original_type TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',                 -- JSON array
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'lifecycle_gc',        -- 'lifecycle_gc' | 'manual' | 'merge'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GC 日志
CREATE TABLE IF NOT EXISTS gc_log (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  gc_type TEXT NOT NULL,
  memories_scanned INTEGER NOT NULL DEFAULT 0,
  duplicates_merged INTEGER NOT NULL DEFAULT 0,
  compressed INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gc_log_run ON gc_log(run_id);
CREATE INDEX IF NOT EXISTS idx_gc_log_type ON gc_log(gc_type);

-- 来源信誉
CREATE TABLE IF NOT EXISTS source_reputation (
  client_id TEXT PRIMARY KEY,
  reputation_score REAL NOT NULL DEFAULT 80.0,       -- 0-100
  total_memories INTEGER NOT NULL DEFAULT 0,
  gc_cleaned_count INTEGER NOT NULL DEFAULT 0,
  gc_cleaned_rate REAL NOT NULL DEFAULT 0.0,
  importance_penalty REAL NOT NULL DEFAULT 0.0,       -- 0-1
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════
-- 做梦与任务
-- ═══════════════════════════════════════════════════════════

-- 做梦日志
CREATE TABLE IF NOT EXISTS dream_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  phase INTEGER NOT NULL,
  narrative TEXT NOT NULL DEFAULT '',
  l1_to_l2 INTEGER NOT NULL DEFAULT 0,
  l2_to_l3 INTEGER NOT NULL DEFAULT 0,
  l3_to_l4 INTEGER NOT NULL DEFAULT 0,
  pages_created INTEGER NOT NULL DEFAULT 0,
  pages_updated INTEGER NOT NULL DEFAULT 0,
  compile_queue_processed INTEGER NOT NULL DEFAULT 0,
  pre_snapshot_id TEXT,
  post_snapshot_id TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dream_logs_session ON dream_logs(session_id);

-- 工作任务
CREATE TABLE IF NOT EXISTS work_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority_score REAL NOT NULL DEFAULT 5.0,
  linked_memories TEXT NOT NULL DEFAULT '[]',          -- JSON array
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_tasks_status ON work_tasks(status);
CREATE INDEX IF NOT EXISTS idx_work_tasks_priority ON work_tasks(priority_score DESC);

-- ═══════════════════════════════════════════════════════════
-- 可观测性
-- ═══════════════════════════════════════════════════════════

-- 链路追踪
CREATE TABLE IF NOT EXISTS memory_traces (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  span_name TEXT NOT NULL,
  phase TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'success',
  metadata TEXT NOT NULL DEFAULT '{}',                -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON memory_traces(trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_memory ON memory_traces(memory_id, memory_type);

-- ═══════════════════════════════════════════════════════════
-- 系统元数据
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════
-- Issue-32: 调度器状态持久化（启动补偿机制）
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scheduler_state (
  task_name  TEXT PRIMARY KEY,
  last_run   TEXT NOT NULL,      -- ISO 8601 时间戳
  status     TEXT DEFAULT 'ok',  -- 'ok' | 'failed' | 'skipped'
  updated_at TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════
-- MINIMEM-001: 领域隔离
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS domains (
  name        TEXT PRIMARY KEY,
  label       TEXT,
  description TEXT,
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════
-- REQ-013: 编译链追踪（反馈传播）
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compilation_trace (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compilation_trace_source ON compilation_trace(source_id);
CREATE INDEX IF NOT EXISTS idx_compilation_trace_target ON compilation_trace(target_id);

-- ═══════════════════════════════════════════════════════════
-- REQ-016: LLM 响应缓存
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS llm_cache (
  id TEXT PRIMARY KEY,
  prompt_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  response TEXT NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}',
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_cache_hash_model ON llm_cache(prompt_hash, model);
CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_cache(expires_at);

-- ═══════════════════════════════════════════════════════════
-- MINIMEM-002: 灵感池
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inspirations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  hypothesis TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'dream_association',
  source_memory_ids TEXT NOT NULL DEFAULT '[]',     -- JSON array
  source_layers TEXT NOT NULL DEFAULT '[]',         -- JSON array
  source_domains TEXT NOT NULL DEFAULT '[]',        -- JSON array
  novelty REAL NOT NULL DEFAULT 0.5,
  actionability REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.3,
  status TEXT NOT NULL DEFAULT 'spark',
  incubation_count INTEGER NOT NULL DEFAULT 0,
  incubation_log TEXT NOT NULL DEFAULT '[]',        -- JSON array of IncubationEntry
  acted_outcome TEXT,
  tags TEXT NOT NULL DEFAULT '[]',                  -- JSON array
  embedding_id TEXT,
  domain TEXT NOT NULL DEFAULT 'default',
  branch TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inspirations_status ON inspirations(status);
CREATE INDEX IF NOT EXISTS idx_inspirations_origin ON inspirations(origin);
CREATE INDEX IF NOT EXISTS idx_inspirations_domain ON inspirations(domain);
CREATE INDEX IF NOT EXISTS idx_inspirations_confidence ON inspirations(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_inspirations_expires ON inspirations(expires_at);
CREATE INDEX IF NOT EXISTS idx_inspirations_created ON inspirations(created_at DESC);
`;

/**
 * 初始化 Surface Files 的默认数据
 */
export const SEED_SURFACE_FILES_SQL = `
INSERT OR IGNORE INTO surface_files (file_name, content, token_count, budget_tokens) VALUES
  ('me.md',      '# 关于我\n\n（等待记忆积累后自动生成）\n', 10, 800),
  ('soul.md',    '# 灵魂画像\n\n（等待记忆积累后自动生成）\n', 10, 1200),
  ('work.md',    '# 工作笔记\n\n（等待记忆积累后自动生成）\n', 10, 1500),
  ('social.md',  '# 社交网络\n\n（等待记忆积累后自动生成）\n', 10, 1200),
  ('life.md',    '# 生活日志\n\n（等待记忆积累后自动生成）\n', 10, 1000),
  ('agent.md',   '# Agent 指南\n\n（等待记忆积累后自动生成）\n', 10, 1000),
  ('context.md', '# 当前上下文\n\n（等待会话信息后自动更新）\n', 10, 1500),
  ('index.md',   '# 知识索引\n\n（等待知识页面编译后自动生成）\n', 10, 800),
  ('insight.md', '# 灵感洞察\n\n（等待做梦后自动生成）\n', 10, 1000);
`;

/**
 * 初始化默认分支
 */
export const SEED_BRANCH_SQL = `
INSERT OR IGNORE INTO branches (name, is_active) VALUES ('main', 1);
`;

/**
 * 初始化系统元数据
 */
export const SEED_META_SQL = `
INSERT OR IGNORE INTO _meta (key, value) VALUES
  ('schema_version', '5'),
  ('created_at', datetime('now')),
  ('minimem_version', '0.2.0');
`;

/**
 * MINIMEM-001: 初始化默认领域
 */
export const SEED_DOMAINS_SQL = `
INSERT OR IGNORE INTO domains (name, label, description) VALUES
  ('default', '默认', '未分类记忆的默认领域'),
  ('work', '工作', '工作相关的记忆和体验'),
  ('personal', '个人', '个人生活相关的记忆');
`;
