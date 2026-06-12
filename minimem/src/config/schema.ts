// ============================================================
// MiniMem — 配置 Schema（Zod 运行时校验）
// ============================================================

import { z } from 'zod';

// ── 枚举约束 ──

const ServerModeSchema = z.enum(['local', 'self-hosted', 'cloud']);
const EncryptionProviderSchema = z.enum(['sqlcipher', 'none']);
const KeyStorageSchema = z.enum(['keychain', 'env']);
const PiiDetectionSchema = z.enum(['mask', 'reject', 'keep']);
const VectorProviderSchema = z.enum(['memory', 'qdrant', 'chroma']);

const SurfaceFileNameSchema = z.enum([
  'me.md', 'soul.md', 'work.md', 'social.md',
  'life.md', 'agent.md', 'context.md', 'index.md', 'insight.md',
]);

// ── 配置 Schema ──

export const MiniMemConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    mode: ServerModeSchema,
  }),

  auth: z.object({
    enabled: z.boolean(),
    jwt_secret_env: z.string(),
    token_expiry: z.string().regex(/^\d+[dhms]$/, 'token_expiry 格式应为 "7d", "24h" 等'),
  }),

  encryption: z.object({
    enabled: z.boolean(),
    provider: EncryptionProviderSchema,
    key_storage: KeyStorageSchema,
  }),

  llm: z.object({
    provider: z.string().min(1),
    base_url: z.string().url('llm.base_url 必须是合法 URL'),
    api_key_env: z.string().min(1),
    models: z.object({
      heavy: z.string().min(1),
      medium: z.string().min(1),
      light: z.string().min(1),
      vision: z.string().min(1).optional(),
    }),
    embedding: z.object({
      enabled: z.boolean(),
      model: z.string().min(1),
      dimensions: z.number().int().positive(),
      base_url: z.string(), // 空字符串 = 复用 llm.base_url
      api_key_env: z.string(), // 空字符串 = 复用 llm.api_key_env
    }),
    timeout_ms: z.number().int().min(1000).max(120_000),
    max_input_tokens: z.number().int().min(100).max(128_000),
    retry: z.object({
      max_attempts: z.number().int().min(1).max(10),
      base_delay_ms: z.number().int().min(100).max(60_000),
      max_delay_ms: z.number().int().min(1000).max(300_000),
    }),
    // P0+P1: LLM 限流配置（Coding Plan 限流保护）
    rate_limit: z.object({
      max_concurrency: z.number().int().min(1).max(20),          // 最大并发请求数
      min_interval_ms: z.number().int().min(0).max(10_000),      // 请求最小间隔（毫秒）
      jitter_max_ms: z.number().int().min(0).max(5_000),         // Jitter 随机范围上限
      quota_5h: z.number().int().positive(),                     // 5h 窗口配额
      quota_weekly: z.number().int().positive(),                 // 周窗口配额
      quota_monthly: z.number().int().positive(),                // 月窗口配额
      quota_warn_threshold: z.number().min(0).max(1),            // 预警阈值
      degrade_on_exhaustion: z.boolean(),                        // 配额耗尽时是否降级
    }).optional(),
    // TODO: cost_limit 已声明但运行时未实现任何消费/熔断逻辑
    // 保留配置定义以避免 breaking change，未来实现后移除此注释
    cost_limit: z.object({
      daily: z.number().nonnegative(),
      monthly: z.number().nonnegative(),
    }),
    // TODO: batch 配置已声明但 embedBatch 仍为串行调用
    batch: z.object({
      batch_size: z.number().int().positive(),
      max_wait_ms: z.number().int().positive(),
    }),
    // TODO: cache 配置已声明但未实现语义缓存逻辑
    cache: z.object({
      enabled: z.boolean(),
      semantic_threshold: z.number().min(0).max(1),
      ttl_hours: z.number().positive(),
    }),
  }),

  ingest: z.object({
    rate_limit_per_minute: z.number().int().positive(),
    quality_gate_enabled: z.boolean(),
    pii_detection: PiiDetectionSchema,
  }),

  dreaming: z.object({
    schedule: z.string().min(1), // cron 表达式
    auto_trigger_threshold: z.number().int().positive(),
    cold_start_threshold: z.number().int().nonnegative(),
    // MINIMEM-003 E08: 种子选择策略
    seed_selection: z.enum(['random', 'mmr']).optional(),       // 默认 'random'
    mmr_lambda: z.number().min(0).max(1).optional(),            // 默认 0.7
    // MINIMEM-003 E09: Dream 多轮迭代
    max_dream_iterations_daily: z.number().int().min(1).max(10).optional(),  // 默认 2
    max_dream_iterations_weekly: z.number().int().min(1).max(10).optional(), // 默认 3
    // MINIMEM-003 T-E07: 支撑度时间衰减参数
    support_decay_lambda: z.number().min(0).max(1).optional(),          // 默认 0.01
    drift_min_support_weighted: z.number().positive().optional(),       // 默认 1.5
    // MINIMEM-003 E13: 自顶向下编译开关
    top_down_compile: z.boolean().optional(),                           // 默认 true
    // REQ-002: 可配置化晋升门槛
    consolidation: z.object({
      l2_to_l3_min_facts: z.number().int().positive(),
      l3_to_l4_min_confidence: z.number().min(0).max(1),
      l3_to_l4_min_observations: z.number().int().positive(),
      // MINIMEM-003 T-E05: 语义去重阈值
      l2_to_l3_dedup_similarity: z.number().min(0).max(1).optional(), // L3 去重相似度阈值（默认 0.85）
      l3_to_l4_dedup_similarity: z.number().min(0).max(1).optional(), // L4 去重相似度阈值（默认 0.90）
    }).optional(),
    // MINIMEM-002: 灵感引擎配置
    inspiration: z.object({
      enabled: z.boolean(),
      max_sparks_per_dream: z.number().int().min(1).max(20),
      cross_pollinate_pairs: z.number().int().min(1).max(20),
      similarity_window: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
      max_incubations: z.number().int().min(1).max(10),
      incubation_temperature: z.number().min(0).max(2),
      habit_detect_days: z.number().int().min(1).max(365),
      habit_min_occurrences: z.number().int().min(1).max(100),
      score_threshold: z.number().min(0).max(1),
      mature_confidence: z.number().min(0).max(1),
      spark_ttl_days: z.number().int().min(1).max(365),
      incubating_ttl_days: z.number().int().min(1).max(365),
      mature_ttl_days: z.number().int().min(1).max(365),
    }).optional(),
  }),

  // REQ-017: 上下文检索配置
  context: z.object({
    max_total_tokens: z.number().int().positive(),
    default_top_k: z.number().int().positive(),
  }).optional(),

  gc: z.object({
    light_schedule: z.string().min(1),
    standard_schedule: z.string().min(1),
    deep_schedule: z.string().min(1),
    temperature_decay_interval_hours: z.number().positive(),
    // MINIMEM-003 T-E06: 衰减模型配置
    decay_model: z.enum(['linear', 'logarithmic', 'ebbinghaus']).optional(),
    decay_base_rate: z.number().positive().optional(),
    // MINIMEM-003 E11: Ebbinghaus 稳定性增长系数
    ebbinghaus_alpha: z.number().min(0.01).max(1.0).optional(), // 默认 0.3
    storage_quotas: z.object({
      hot: z.number().int().positive(),
      warm: z.number().int().positive(),
      cool: z.number().int().positive(),
      cold: z.number().int().positive(),
      frozen: z.number().int().positive(),
    }),
  }),

  surface: z.object({
    budget_tokens: z.number().int().positive(),
    files: z.array(SurfaceFileNameSchema).min(1),
  }),

  storage: z.object({
    data_dir: z.string().min(1),
    sqlite: z.object({
      wal_mode: z.boolean(),
    }),
    vector: z.object({
      provider: VectorProviderSchema,
      // MINIMEM-003: HNSW 近似最近邻索引参数
      hnsw_m: z.number().int().min(4).max(64).optional(),                    // 每层最大邻居数（默认 16）
      hnsw_ef_construction: z.number().int().min(16).max(800).optional(),    // 构建时搜索宽度（默认 200）
      hnsw_ef_search: z.number().int().min(10).max(500).optional(),          // 查询时搜索宽度（默认 50）
      hnsw_auto_threshold: z.number().int().min(100).max(1_000_000).optional(), // 自动启用 HNSW 的向量数阈值（默认 5000）
      // MINIMEM-003: Qdrant 生产级配置
      qdrant: z.object({
        url: z.string().url(),
        collection: z.string().min(1),
        api_key_env: z.string(),
        health_check_interval_ms: z.number().int().min(5000).max(300_000),
        retry_max_attempts: z.number().int().min(1).max(10),
        retry_base_delay_ms: z.number().int().min(100).max(60_000),
        retry_max_delay_ms: z.number().int().min(1000).max(300_000),
        request_timeout_ms: z.number().int().min(1000).max(60_000),
      }).optional(),
    }),
    log: z.object({
      level: z.string().min(1),
      max_size_mb: z.number().positive(),
      max_files: z.number().int().positive(),
    }),
  }),

  tracing: z.object({
    enabled: z.boolean(),
    retention_days: z.number().int().positive(),
  }),

  backup: z.object({
    enabled: z.boolean(),
    schedule: z.string().min(1),
    retention_count: z.number().int().positive(),
  }),

  scheduler: z.object({
    startup_compensation: z.boolean(),
    compensation_delay_ms: z.number().int().min(0).max(60_000),
  }),

  // MINIMEM-006: Hint-Driven Recall 配置
  recall: z.object({
    enabled: z.boolean(),
    hints: z.object({
      max_hints: z.number().int().min(1).max(10),
      min_relevance: z.number().min(0).max(1),
      token_budget: z.number().int().min(50).max(1000),
      summary_max_chars: z.number().int().min(20).max(300),
      skip_min_length: z.number().int().min(1).max(100),
      signals: z.object({
        semantic_weight: z.number().min(0).max(1),
        entity_weight: z.number().min(0).max(1),
        time_weight: z.number().min(0).max(1),
        graph_weight: z.number().min(0).max(1),
      }),
      cache: z.object({
        embedding_ttl: z.number().int().min(0).max(86400),          // embedding 缓存 TTL（秒）
        summary_ttl: z.number().int().min(0).max(86400),            // 摘要缓存 TTL（秒）
        session_reuse_threshold: z.number().min(0).max(1),          // 同 session 复用阈值
      }),
    }),
    auto: z.object({
      default_mode: z.enum(['hint', 'full', 'smart']),
      intent_model: z.string().min(1),                              // 意图判断使用的模型（通常 light）
      intent_timeout_ms: z.number().int().min(100).max(10_000),
    }),
  }).optional(),

  // MINIMEM-001: 领域隔离配置
  domain: z.object({
    default_domain: z.string().min(1),
    rules: z.object({
      source_map: z.record(z.string(), z.string()),  // { "project-memory": "work", ... }
      ai_classify: z.object({
        enabled: z.boolean(),
        confidence_threshold: z.number().min(0).max(1),
      }),
    }),
  }),

  // REQ-021: 外部数据源连接器
  connectors: z.object({
    enabled: z.boolean(),
    webhook: z.object({
      enabled: z.boolean(),
      port: z.number().int().min(1).max(65535),
      path: z.string().min(1),
      secret: z.string(),
      source_tag: z.string(),
    }).optional(),
    file_watcher: z.object({
      enabled: z.boolean(),
      watch_dirs: z.array(z.string()),
      extensions: z.array(z.string()),
      max_file_size_bytes: z.number().int().positive(),
      debounce_ms: z.number().int().positive(),
      recursive: z.boolean(),
      source_tag: z.string(),
    }).optional(),
  }).optional(),

  // MINIMEM-005: 多模态感知配置
  perception: z.object({
    enabled: z.boolean(),
    multimodal: z.object({
      url: z.object({
        timeout_ms: z.number().int().min(1000).max(120_000),
        max_output_length: z.number().int().min(1000).max(500_000),
        user_agent: z.string().min(1),
        max_redirects: z.number().int().min(0).max(20),
        dns_resolve_check: z.boolean(),
        blocked_domains: z.array(z.string()),
      }).optional(),
      file: z.object({
        max_file_size_mb: z.number().min(0.1).max(100),
        max_chunk_size: z.number().int().min(1000).max(500_000),
        chunk_overlap: z.number().int().min(0).max(10_000),
        max_chunks: z.number().int().min(1).max(100),
        allowed_extensions: z.array(z.string()).min(1),
      }).optional(),
      image: z.object({
        max_size_mb: z.number().min(0.1).max(100),
        allowed_formats: z.array(z.string()).min(1),
        max_description_tokens: z.number().int().min(100).max(10_000),
        rate_limit_per_minute: z.number().int().min(1).max(100),
      }).optional(),
    }).optional(),
  }).optional(),
});

// ── 校验函数 ──

export type ConfigValidationResult = {
  valid: true;
} | {
  valid: false;
  errors: Array<{ path: string; message: string }>;
};

/**
 * 校验配置对象，返回详细的错误信息
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result = MiniMemConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true };
  }

  const errors = result.error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  return { valid: false, errors };
}
