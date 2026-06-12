// ============================================================
// MiniMem — 核心类型定义
// ============================================================

// ── 记忆层级 ──

export type MemoryLayer = 'L1' | 'L2' | 'L3' | 'L4';

export type ContentType = 'conversation' | 'event' | 'reflection' | 'decision' | 'note' | 'import' | 'url_import' | 'image_import' | 'file_import';

export type MemorySource = string; // "codebuddy" | "openclaw" | "agent_x" | ...

// ── 领域隔离 (MINIMEM-001) ──

export interface Domain {
  name: string;         // 主键，如 'work', 'personal'
  label: string | null; // 显示名称，如 '工作', '个人'
  description: string | null;
  color: string | null; // UI 用颜色标识（可选）
  created_at: string;
  updated_at: string;
}

// ── L1 经历 ──

export interface Experience {
  id: string;
  raw_content: string;
  content_type: ContentType;
  source: MemorySource;
  importance: number; // 0-1
  tags: string[];
  participants: string[];
  context: string | null;
  embedding_id: string | null;
  snapshot_id: string | null;
  branch: string;
  domain: string; // MINIMEM-001: 领域隔离
  created_at: string; // ISO 8601
  updated_at: string;
}

// ── L2 事实（三元组） ──

export interface WorldFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number; // 0-1
  valid_from: string | null;
  valid_until: string | null;
  evidence_experience_ids: string[]; // L1 IDs
  condition_keys: string[]; // 条件索引键
  source: MemorySource;
  snapshot_id: string | null;
  branch: string;
  domain: string; // MINIMEM-001: 领域隔离
  created_at: string;
  updated_at: string;
}

// ── L3 观察（散点） ──

export type ObservationType = 'pattern' | 'trend' | 'preference' | 'habit' | 'insight';

export interface Observation {
  id: string;
  description: string;
  observation_type: ObservationType;
  supporting_fact_ids: string[];
  contradicting_fact_ids: string[];
  confidence: number;
  confidence_history: Array<{ date: string; value: number }>;
  tags: string[];
  drift_risk: boolean;  // REQ-012 / TODO-017: 信念漂移风险标记
  snapshot_id: string | null;
  branch: string;
  domain: string; // MINIMEM-001: 领域隔离
  created_at: string;
  updated_at: string;
}

// ── L3 知识页面 (Karpathy Compile) ──

export type PageType = 'person' | 'topic' | 'project' | 'concept' | 'skill' | 'place' | 'event_series';

export type LintStatus = 'healthy' | 'stale' | 'orphaned' | 'conflicted' | 'missing';

export type KnowledgePageStatus = 'active' | 'draft' | 'archived';

export interface KnowledgePage {
  id: string;
  slug: string; // 唯一标识，如 "alice-chen"
  title: string;
  page_type: PageType;
  content: string; // Markdown + [[backlink]] 语法
  summary: string; // 摘要（Console 展示用）
  domain: string; // 领域（如 "SRE"、"编程"）
  tags: string[]; // 标签数组
  status: KnowledgePageStatus; // active / draft / archived
  compile_count: number;
  last_compiled: string | null;
  lint_status: LintStatus;
  staleness_score: number; // 0-1
  confidence: number;
  embedding_id: string | null;
  snapshot_id: string | null;
  branch: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgePageLink {
  id: string;
  from_page_id: string;
  to_page_id: string;
  link_context: string; // 链接上下文描述
  created_at: string;
}

export interface KnowledgePageEvidence {
  id: string;
  page_id: string;
  evidence_type: 'l1' | 'l2' | 'l3';
  evidence_id: string;
  section_hint: string | null; // 对应页面中的哪个段落
  created_at: string;
}

// ── 灵感层 (MINIMEM-002) ──

export type InspirationStatus = 'spark' | 'incubating' | 'mature' | 'acted' | 'archived';

export type InspirationOrigin =
  | 'dream_association'         // 来自 Dream Phase 3 的联想
  | 'cross_domain'              // 跨域碰撞产生
  | 'contradiction_resolution'  // 矛盾解决过程中产生
  | 'temporal_convergence'      // 时间模式汇聚
  | 'habit_detection'           // 习惯/错误模式检测
  | 'user_triggered';           // 用户主动触发

export interface IncubationEntry {
  round: number;                    // 第几轮孵化
  new_angles: string[];             // 本轮引入的新思考角度（记忆 ID）
  deepened: boolean;                // 是否被深化
  summary: string;                  // LLM 的孵化结果摘要
  confidence_delta: number;         // 信心变化值
  timestamp: string;
}

export interface Inspiration {
  id: string;
  title: string;                    // 一句话标题
  content: string;                  // 灵感的详细描述
  hypothesis: string;               // "所以我们可以..." 的可行动推论
  origin: InspirationOrigin;        // 灵感来源类型
  source_memory_ids: string[];      // 碰撞来源（跨层、跨域的记忆 ID）
  source_layers: MemoryLayer[];     // 来源层级（如 ['L1', 'L3'] 表示 L1+L3 碰撞）
  source_domains: string[];         // 来源领域（跨域碰撞的核心标记）
  novelty: number;                  // 0-1，新颖度
  actionability: number;            // 0-1，可行动性
  confidence: number;               // 0-1，可信度（初始较低，经过孵化后提升）
  status: InspirationStatus;        // 生命周期状态
  incubation_count: number;         // 孵化次数（被重新思考了几轮）
  incubation_log: IncubationEntry[]; // 每次孵化的记录
  acted_outcome: string | null;     // 如果被行动了，结果是什么
  tags: string[];
  embedding_id: string | null;
  domain: string;                   // MINIMEM-001: 领域隔离
  branch: string;
  created_at: string;
  updated_at: string;
  expires_at: string;               // 灵感保鲜期
}

// ── 编译队列 ──

export type CompileSourceType = 'new_fact' | 'query_insight' | 'feedback' | 'lint_finding' | 'embedding_backfill' | 'conflict_resolution' | 'inspiration';
export type CompileStatus = 'pending' | 'compiled' | 'skipped';

export interface CompileQueueItem {
  id: string;
  source_type: CompileSourceType;
  content: string;
  target_page: string | null; // slug or null
  priority: number; // 0-10
  status: CompileStatus;
  created_at: string;
  processed_at: string | null;
}

// ── L4 心智模型 ──

export type ModelType = 'principle' | 'preference' | 'rule' | 'belief' | 'value';

export interface MentalModel {
  id: string;
  title: string;
  content: string;
  model_type: ModelType;
  priority: number; // 1-10
  scope: string; // "global" | "work" | "social" | ...
  origin: string; // 来源说明
  is_active: boolean;
  snapshot_id: string | null;
  branch: string;
  domain: string; // MINIMEM-001: 领域隔离
  created_at: string;
  updated_at: string;
}

// ── 温度模型 ──

export type TemperatureLevel = 'hot' | 'warm' | 'cool' | 'cold' | 'frozen';

export interface MemoryTemperature {
  memory_id: string;
  memory_type: MemoryLayer;
  temperature: TemperatureLevel;
  score: number; // 0-100
  access_count: number;
  last_accessed: string | null;
  pinned: boolean;
  compression_level: number; // 0=none, 1=summary, 2=key-points, 3=one-line
  // MINIMEM-003 E10: Ebbinghaus 遗忘曲线字段
  stability: number;        // 记忆稳定性（小时），越高衰减越慢
  review_count: number;     // 复习次数（每次 recordAccess 递增）
  initial_score: number;    // 初始分数（用于遗忘曲线计算基准）
  created_at: string;
  updated_at: string;
}

// ── 客户端 & 认证 ──

export type PermissionLevel = 'trusted' | 'standard' | 'readonly';

export interface Client {
  id: string;
  name: string;
  client_secret_hash: string;
  permission_level: PermissionLevel;
  read_layers: MemoryLayer[];
  can_write: boolean;
  can_dream: boolean;
  can_snapshot: boolean;
  reads_per_minute: number;
  writes_per_minute: number;
  is_active: boolean;
  created_at: string;
}

// ── Owner Profile ──

export interface OwnerProfileEntry {
  key: string; // e.g. "identity.name", "preferences.coding.language"
  value: unknown; // JSON value
  category: string; // "identity" | "preferences" | "personality" | ...
  confidence: number;
  source: MemorySource;
  updated_at: string;
}

// ── Person Profile ──

export interface PersonProfile {
  id: string;
  name: string;
  aliases: string[];
  personality: string | null;
  interests: string[];
  opinions: Record<string, string>;
  speech_patterns: string[];
  relationships: Array<{ person: string; type: string }>;
  first_seen: string;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

// ── Surface Files ──

export type SurfaceFileName = 'me.md' | 'soul.md' | 'work.md' | 'social.md' | 'life.md' | 'agent.md' | 'context.md' | 'index.md' | 'insight.md';

export interface SurfaceFile {
  file_name: SurfaceFileName;
  content: string;
  token_count: number;
  budget_tokens: number;
  version: number;
  updated_at: string;
}

// ── 版本控制 ──

export interface Snapshot {
  id: string;
  label: string;
  branch: string;
  trigger: 'manual' | 'dream' | 'gc' | 'import' | 'auto';
  parent_snapshot_id: string | null;
  stats_l1: number;
  stats_l2: number;
  stats_l3: number;
  stats_l4: number;
  stats_pages: number;
  created_at: string;
}

export interface Branch {
  name: string;
  created_from_snapshot: string | null;
  is_active: boolean;
  created_at: string;
}

// ── 条件索引 ──

export interface ConditionIndexEntry {
  condition_key: string; // e.g. "person:alice", "topic:typescript"
  memory_type: MemoryLayer;
  memory_id: string;
}

// ── 知识图谱 ──

export type LinkType = 'related' | 'caused' | 'contradicts' | 'supports' | 'part_of' | 'derived_from';

export interface MemoryLink {
  id: string;
  source_id: string;
  source_type: MemoryLayer;
  target_id: string;
  target_type: MemoryLayer;
  link_type: LinkType;
  weight: number; // 0-1
  created_at: string;
}

// ── 做梦 ──

export interface DreamLog {
  id: string;
  session_id: string;
  phase: 1 | 2 | 3 | 4;
  narrative: string;
  l1_to_l2: number;
  l2_to_l3: number;
  l3_to_l4: number;
  pages_created: number;
  pages_updated: number;
  compile_queue_processed: number;
  pre_snapshot_id: string;
  post_snapshot_id: string | null;
  duration_ms: number;
  created_at: string;
}

// ── 审计 ──

export interface AuditLogEntry {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  before_value: string | null;
  after_value: string | null;
  triggered_by: string; // client_id or "system"
  created_at: string;
}

export interface AccessLogEntry {
  id: string;
  client_id: string;
  action: string;
  tool_name: string;
  params_summary: string | null;
  result_summary: string | null;
  latency_ms: number;
  created_at: string;
}

// ── 可观测性 ──

export interface MemoryTrace {
  id: string;
  trace_id: string;
  memory_id: string;
  memory_type: MemoryLayer;
  span_name: string;
  phase: string;
  result: 'success' | 'failure' | 'skip';
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── 来源信誉 ──

export interface SourceReputation {
  client_id: string;
  reputation_score: number; // 0-100
  total_memories: number;
  gc_cleaned_count: number;
  gc_cleaned_rate: number; // 0-1
  importance_penalty: number; // 0-1, 惩罚系数
  updated_at: string;
}

// ── 工作任务 ──

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface WorkTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority_score: number;
  linked_memories: string[];
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

// ── GC 日志 ──

export type GCType = 'temperature_decay' | 'light' | 'standard' | 'deep' | 'emergency';

export interface GCLog {
  id: string;
  run_id: string;
  gc_type: GCType;
  memories_scanned: number;
  duplicates_merged: number;
  compressed: number;
  deleted: number;
  duration_ms: number;
  created_at: string;
}

// ── 通用 ──

export interface PaginationParams {
  page: number;
  page_size: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface MiniMemConfig {
  server: {
    host: string;
    port: number;
    mode: 'local' | 'self-hosted' | 'cloud';
  };
  auth: {
    enabled: boolean;
    jwt_secret_env: string;
    token_expiry: string; // e.g. "7d"
  };
  encryption: {
    enabled: boolean;
    provider: 'sqlcipher' | 'none';
    key_storage: 'keychain' | 'env';
  };
  llm: {
    provider: string;
    base_url: string;
    api_key_env: string;
    models: {
      heavy: string;
      medium: string;
      light: string;
      vision?: string;
    };
    embedding: {
      enabled: boolean;
      model: string;
      dimensions: number;
      base_url: string;   // 空字符串 = 复用 llm.base_url
      api_key_env: string; // 空字符串 = 复用 llm.api_key_env
    };
    vision: {
      model: string;       // 空字符串 = 回退到 heavy 模型
      base_url: string;    // 空字符串 = 复用 llm.base_url
      api_key_env: string; // 空字符串 = 复用 llm.api_key_env
    };
    timeout_ms: number;           // 单次请求超时（毫秒）
    max_input_tokens: number;     // 单条消息最大输入 token 数（超过自动截断）
    retry: {
      max_attempts: number;        // 最大重试次数（含首次）
      base_delay_ms: number;       // 退避基准延迟
      max_delay_ms: number;        // 退避最大延迟
    };
    cost_limit: {
      daily: number;
      monthly: number;
    };
    batch: {
      batch_size: number;
      max_wait_ms: number;
    };
    cache: {
      enabled: boolean;
      semantic_threshold: number;
      ttl_hours: number;
    };
  };
  ingest: {
    rate_limit_per_minute: number;
    quality_gate_enabled: boolean;
    pii_detection: 'mask' | 'reject' | 'keep';
  };
  dreaming: {
    schedule: string; // cron
    auto_trigger_threshold: number;
    cold_start_threshold: number;
    // MINIMEM-003 E08: 种子选择策略
    seed_selection?: 'random' | 'mmr';
    mmr_lambda?: number; // 默认 0.7
    // MINIMEM-003 E09: Dream 多轮迭代
    max_dream_iterations_daily?: number;    // 默认 2
    max_dream_iterations_weekly?: number;   // 默认 3
    // MINIMEM-003 T-E07: 支撑度时间衰减参数
    support_decay_lambda?: number;          // 默认 0.01
    drift_min_support_weighted?: number;    // 默认 1.5
    // MINIMEM-003 E13: 自顶向下编译开关
    top_down_compile?: boolean;             // 默认 true
    // REQ-002: 可配置化晋升门槛
    consolidation?: {
      l2_to_l3_min_facts: number;
      l3_to_l4_min_confidence: number;
      l3_to_l4_min_observations: number;
      // MINIMEM-003 T-E05: 语义去重阈值
      l2_to_l3_dedup_similarity?: number; // L3 去重相似度阈值（默认 0.85）
      l3_to_l4_dedup_similarity?: number; // L4 去重相似度阈值（默认 0.90）
    };
    // MINIMEM-002: 灵感层配置
    inspiration?: {
      enabled: boolean;
      max_sparks_per_dream: number;
      cross_pollinate_pairs: number;
      similarity_window: [number, number];
      max_incubations: number;
      incubation_temperature: number;
      habit_detect_days: number;
      habit_min_occurrences: number;
      score_threshold: number;
      mature_confidence: number;
      spark_ttl_days: number;
      incubating_ttl_days: number;
      mature_ttl_days: number;
    };
  };
  // REQ-017: 上下文检索配置
  context?: {
    max_total_tokens: number;
    default_top_k: number;
  };
  gc: {
    light_schedule: string;
    standard_schedule: string;
    deep_schedule: string;
    temperature_decay_interval_hours: number;
    // MINIMEM-003 T-E06: 衰减模型配置
    decay_model?: 'linear' | 'logarithmic' | 'ebbinghaus';
    decay_base_rate?: number;
    // MINIMEM-003 E11: Ebbinghaus 稳定性增长系数
    ebbinghaus_alpha?: number; // 默认 0.3
    storage_quotas: {
      hot: number;
      warm: number;
      cool: number;
      cold: number;
      frozen: number;
    };
  };
  surface: {
    budget_tokens: number;
    files: SurfaceFileName[];
  };
  storage: {
    data_dir: string;
    sqlite: {
      wal_mode: boolean;
    };
    vector: {
      provider: 'memory' | 'qdrant' | 'chroma';
      // MINIMEM-003: HNSW 近似最近邻索引参数
      hnsw_m?: number;                // 每层最大邻居数（默认 16）
      hnsw_ef_construction?: number;  // 构建时搜索宽度（默认 200）
      hnsw_ef_search?: number;        // 查询时搜索宽度（默认 50）
      hnsw_auto_threshold?: number;   // 自动启用 HNSW 的向量数阈值（默认 5000）
      // MINIMEM-003: Qdrant 生产级配置
      qdrant?: {
        url: string;
        collection: string;
        api_key_env: string;
        health_check_interval_ms: number;
        retry_max_attempts: number;
        retry_base_delay_ms: number;
        retry_max_delay_ms: number;
        request_timeout_ms: number;
      };
    };
    log: {
      level: string;
      max_size_mb: number;
      max_files: number;
    };
  };
  tracing: {
    enabled: boolean;
    retention_days: number;
  };
  backup: {
    enabled: boolean;
    schedule: string;
    retention_count: number;
  };
  scheduler: {
    startup_compensation: boolean;  // Issue-32: 启动补偿开关
    compensation_delay_ms: number;  // 启动后延迟多少毫秒执行补偿
  };
  // MINIMEM-001: 领域隔离配置
  domain: {
    default_domain: string; // 默认领域名，如 'default'
    rules: {
      source_map: Record<string, string>; // 来源 → 领域映射，如 { "project-memory": "work" }
      ai_classify: {
        enabled: boolean;
        confidence_threshold: number; // 0-1
      };
    };
  };
  // REQ-021: 外部数据源连接器
  connectors?: {
    enabled: boolean;
    webhook?: {
      enabled: boolean;
      port: number;
      path: string;
      secret: string;
      source_tag: string;
    };
    file_watcher?: {
      enabled: boolean;
      watch_dirs: string[];
      extensions: string[];
      max_file_size_bytes: number;
      debounce_ms: number;
      recursive: boolean;
      source_tag: string;
    };
  };
  // MINIMEM-005: 多模态感知配置
  perception?: {
    enabled: boolean;
    multimodal?: {
      url?: {
        timeout_ms: number;
        max_output_length: number;
        user_agent: string;
        max_redirects: number;
        dns_resolve_check: boolean;
        blocked_domains: string[];
      };
      file?: {
        max_file_size_mb: number;
        max_chunk_size: number;
        chunk_overlap: number;
        max_chunks: number;
        allowed_extensions: string[];
      };
      image?: {
        max_size_mb: number;
        allowed_formats: string[];
        max_description_tokens: number;
        rate_limit_per_minute: number;
      };
    };
  };
}
