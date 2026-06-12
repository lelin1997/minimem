// ============================================================
// MiniMem — 配置管理
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseToml } from 'toml';
import { getLogger } from '../common/logger.js';
import { StorageError } from '../common/errors.js';
import { validateConfig } from './schema.js';
import type { MiniMemConfig, SurfaceFileName } from '../common/types.js';

// 用 import.meta.url 定位项目根目录，不依赖 process.cwd()
// src/config/index.ts → 上两级 = 项目根（dist/config/index.js 可能不存在，但 tsup 打包为单文件 dist/index.js，这里只有源码路径需要考虑）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// config/index.ts 在 src/config/ 下，向上两级是项目根
// 打包后 dist/index.js 是单文件，loadConfig() 运行时 __dirname 是 dist/ 的 chunk 目录或 dist/ 本身
// 所以用一个 helper 函数来可靠定位
function findProjectRoot(): string {
  // 策略：从 __dirname 往上找 config.default.toml 所在的目录
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'config.default.toml'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  // fallback: process.cwd()（兼容旧行为）
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();

const log = getLogger('config');

// ── 默认配置 ──

const DEFAULT_DATA_DIR = resolve(
  process.env.MINIMEM_DATA_DIR ?? join(process.env.HOME ?? '~', '.minimem'),
);

export const DEFAULT_CONFIG: MiniMemConfig = {
  server: {
    host: '127.0.0.1',
    port: 6677,
    mode: 'local',
  },
  auth: {
    enabled: true,
    jwt_secret_env: 'MINIMEM_JWT_SECRET',
    token_expiry: '7d',
  },
  encryption: {
    enabled: true,
    provider: 'sqlcipher',
    key_storage: 'keychain',
  },
  llm: {
    provider: 'openai-compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key_env: 'MINIMEM_LLM_API_KEY',
    models: {
      heavy: 'qwen-max',
      medium: 'qwen-plus',
      light: 'qwen-turbo',
    },
    embedding: {
      enabled: true,
      model: 'text-embedding-v3',
      dimensions: 1024,
      base_url: '',   // 空 = 复用 llm.base_url
      api_key_env: '', // 空 = 复用 llm.api_key_env
    },
    vision: {
      model: '',       // 空 = 回退到 heavy 模型
      base_url: '',    // 空 = 复用 llm.base_url
      api_key_env: '', // 空 = 复用 llm.api_key_env
    },
    timeout_ms: 30_000,  // 30 秒
    max_input_tokens: 6_000, // 单条消息最大 token（约 8K 窗口的 75%）
    retry: {
      max_attempts: 3,
      base_delay_ms: 1_000,
      max_delay_ms: 10_000,
    },
    cost_limit: {
      daily: 10,
      monthly: 200,
    },
    batch: {
      batch_size: 10,
      max_wait_ms: 300_000, // 5 min
    },
    cache: {
      enabled: true,
      semantic_threshold: 0.95,
      ttl_hours: 24,
    },
  },
  ingest: {
    rate_limit_per_minute: 60,
    quality_gate_enabled: true,
    pii_detection: 'mask',
  },
  dreaming: {
    schedule: '0 3 * * *', // 每天凌晨 3 点
    auto_trigger_threshold: 50,
    cold_start_threshold: 20,
    // REQ-002: 可配置化晋升门槛
    consolidation: {
      l2_to_l3_min_facts: 2,         // 原硬编码 3，降低门槛
      l3_to_l4_min_confidence: 0.6,  // 原硬编码 0.7，降低门槛
      l3_to_l4_min_observations: 2,  // 保持不变
    },
  },
  // REQ-017: 上下文检索配置
  context: {
    max_total_tokens: 8000,
    default_top_k: 5,
  },
  gc: {
    light_schedule: '0 */6 * * *',
    standard_schedule: '0 4 * * *',
    deep_schedule: '0 5 * * 0',
    temperature_decay_interval_hours: 6,
    storage_quotas: {
      hot: 500,
      warm: 2000,
      cool: 10000,
      cold: 50000,
      frozen: 200000,
    },
  },
  surface: {
    budget_tokens: 10000,
    files: ['me.md', 'soul.md', 'work.md', 'social.md', 'life.md', 'agent.md', 'context.md', 'index.md', 'insight.md'],
  },
  storage: {
    data_dir: DEFAULT_DATA_DIR,
    sqlite: {
      wal_mode: true,
    },
    vector: {
      provider: 'memory',
    },
    log: {
      level: 'info',
      max_size_mb: 10,
      max_files: 10,
    },
  },
  tracing: {
    enabled: true,
    retention_days: 30,
  },
  backup: {
    enabled: true,
    schedule: '0 2 * * *', // 每天凌晨 2 点
    retention_count: 7,
  },
  scheduler: {
    startup_compensation: true,     // Issue-32: 默认开启启动补偿
    compensation_delay_ms: 5_000,   // 启动后 5 秒
  },
  // MINIMEM-001: 领域隔离
  domain: {
    default_domain: 'default',
    rules: {
      source_map: {},               // 来源→领域映射，如 { "project-memory": "work" }
      ai_classify: {
        enabled: false,
        confidence_threshold: 0.8,
      },
    },
  },
  // REQ-021: 外部数据源连接器
  connectors: {
    enabled: false,
    webhook: {
      enabled: false,
      port: 6679,
      path: '/webhook',
      secret: '',
      source_tag: 'webhook',
    },
    file_watcher: {
      enabled: false,
      watch_dirs: [],
      extensions: ['.md', '.txt'],
      max_file_size_bytes: 100_000,
      debounce_ms: 2000,
      recursive: true,
      source_tag: 'file-watcher',
    },
  },
};

// ── 配置加载 ──

let _config: MiniMemConfig | null = null;

/**
 * 加载配置（优先级从低到高）：
 *   默认值 → config.toml → config.local.toml → 环境变量
 *
 * config.local.toml 放在项目根目录，已被 .gitignore 忽略，
 * 用于存放本地个性化配置（如 LLM 提供商、模型选择等），不会提交到 git。
 */
export function loadConfig(configPath?: string): MiniMemConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  // 1. 从全局 config.toml 加载（~/.minimem/config.toml）
  const tomlPath = configPath ?? resolve(config.storage.data_dir, 'config.toml');
  if (existsSync(tomlPath)) {
    try {
      const tomlContent = readFileSync(tomlPath, 'utf-8');
      const tomlConfig = parseToml(tomlContent);
      deepMerge(config as unknown as Record<string, unknown>, tomlConfig as Record<string, unknown>);
      log.info({ path: tomlPath }, 'Loaded config from TOML');
    } catch (err) {
      log.warn({ err, path: tomlPath }, 'Failed to parse config.toml, using defaults');
    }
  }

  // 2. 从项目根目录的 config.local.toml 加载（覆盖全局配置，不提交 git）
  // 用 import.meta.url 定位项目根目录，不依赖 process.cwd()（REPAIR-7 同类问题）
  const localTomlPath = resolve(PROJECT_ROOT, 'config.local.toml');
  if (existsSync(localTomlPath)) {
    try {
      const localContent = readFileSync(localTomlPath, 'utf-8');
      const localConfig = parseToml(localContent);
      deepMerge(config as unknown as Record<string, unknown>, localConfig as Record<string, unknown>);
      log.info({ path: localTomlPath }, 'Loaded local config override from config.local.toml');
    } catch (err) {
      log.warn({ err, path: localTomlPath }, 'Failed to parse config.local.toml');
    }
  }

  // 3. 环境变量覆盖（最高优先级）
  applyEnvOverrides(config);

  // 4. Schema 校验（运行时类型 + 值范围检查）
  const validation = validateConfig(config);
  if (!validation.valid) {
    const errorDetails = validation.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n');
    log.warn({ errors: validation.errors }, `Config validation found ${validation.errors.length} issue(s):\n${errorDetails}`);
    // 不抛异常（向后兼容），仅警告。严重错误由业务逻辑发现。
  }

  _config = config;
  return config;
}

/**
 * 获取当前配置（必须先调用 loadConfig）
 */
export function getConfig(): MiniMemConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * 热更新配置（仅允许特定字段）
 * 安全限制：对 base_url 等敏感字段做格式校验
 */
export function updateConfig(updates: Partial<MiniMemConfig>): void {
  if (!_config) throw new Error('Config not loaded');

  // 安全检查：如果 llm.base_url 要被更新，校验 URL 格式
  if (updates.llm && typeof (updates.llm as Record<string, unknown>).base_url === 'string') {
    const newUrl = (updates.llm as Record<string, unknown>).base_url as string;
    try {
      const parsed = new URL(newUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Invalid protocol: ${parsed.protocol}`);
      }
    } catch (err) {
      log.warn({ err, url: newUrl }, 'Rejected config hot-update: invalid base_url');
      throw new Error(`Invalid base_url: ${newUrl}`);
    }
  }

  const HOT_UPDATE_KEYS = ['llm', 'ingest', 'gc', 'dreaming', 'storage'] as const;
  for (const key of HOT_UPDATE_KEYS) {
    if (updates[key]) {
      deepMerge(_config[key] as unknown as Record<string, unknown>, updates[key] as unknown as Record<string, unknown>);
    }
  }

  log.info('Config hot-updated');
}

// ── 内部工具 ──

function applyEnvOverrides(config: MiniMemConfig): void {
  if (process.env.MINIMEM_PORT) config.server.port = parseInt(process.env.MINIMEM_PORT, 10);
  if (process.env.MINIMEM_HOST) config.server.host = process.env.MINIMEM_HOST;
  if (process.env.MINIMEM_DATA_DIR) config.storage.data_dir = process.env.MINIMEM_DATA_DIR;
  if (process.env.MINIMEM_LOG_LEVEL) config.storage.log.level = process.env.MINIMEM_LOG_LEVEL;
  if (process.env.MINIMEM_LLM_PROVIDER) config.llm.provider = process.env.MINIMEM_LLM_PROVIDER;
  if (process.env.MINIMEM_LLM_BASE_URL) config.llm.base_url = process.env.MINIMEM_LLM_BASE_URL;
  if (process.env.MINIMEM_LLM_HEAVY) config.llm.models.heavy = process.env.MINIMEM_LLM_HEAVY;
  if (process.env.MINIMEM_LLM_MEDIUM) config.llm.models.medium = process.env.MINIMEM_LLM_MEDIUM;
  if (process.env.MINIMEM_LLM_LIGHT) config.llm.models.light = process.env.MINIMEM_LLM_LIGHT;
  if (process.env.MINIMEM_AUTH_ENABLED) config.auth.enabled = process.env.MINIMEM_AUTH_ENABLED === 'true';
  // Embedding 独立环境变量覆盖
  if (process.env.MINIMEM_EMBEDDING_ENABLED) config.llm.embedding.enabled = process.env.MINIMEM_EMBEDDING_ENABLED !== 'false';
  if (process.env.MINIMEM_EMBEDDING_MODEL) config.llm.embedding.model = process.env.MINIMEM_EMBEDDING_MODEL;
  if (process.env.MINIMEM_EMBEDDING_DIMENSIONS) config.llm.embedding.dimensions = parseInt(process.env.MINIMEM_EMBEDDING_DIMENSIONS, 10);
  if (process.env.MINIMEM_EMBEDDING_BASE_URL) config.llm.embedding.base_url = process.env.MINIMEM_EMBEDDING_BASE_URL;
  if (process.env.MINIMEM_EMBEDDING_API_KEY_ENV) config.llm.embedding.api_key_env = process.env.MINIMEM_EMBEDDING_API_KEY_ENV;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
    } else {
      target[key] = sourceVal;
    }
  }
}
