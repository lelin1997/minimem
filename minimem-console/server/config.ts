import fs from 'fs';
import path from 'path';
import { parse as parseToml } from 'toml';

// ── 类型定义 ──

export interface AppConfig {
  server: {
    host: string;
    port: number;
  };
  minimem: {
    base_url: string;
    data_dir: string;
    api_token: string;
  };
  llm: {
    provider: string;
    base_url: string;
    api_key: string;
    model: string;
    temperature: number;
    max_tokens: number;
  };
  storage: {
    data_dir: string;
    db_name: string;
  };
  pipeline: {
    output_dir: string;
  };
  smtp: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from_address: string;
    from_name: string;
  };
}

// ── 路径展开 ──

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || '/tmp', p.slice(2));
  }
  return p;
}

// ── 加载配置 ──

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  // 读取默认配置
  const defaultPath = path.resolve(process.cwd(), 'config.default.toml');
  let raw: Record<string, any> = {};
  if (fs.existsSync(defaultPath)) {
    raw = parseToml(fs.readFileSync(defaultPath, 'utf-8'));
  }

  // 用户自定义配置（覆盖默认）
  const userPath = path.resolve(process.cwd(), 'config.toml');
  if (fs.existsSync(userPath)) {
    const userRaw = parseToml(fs.readFileSync(userPath, 'utf-8'));
    raw = deepMerge(raw, userRaw);
  }

  // 构建最终配置，环境变量优先级最高
  _config = {
    server: {
      host: env('CONSOLE_HOST') || raw.server?.host || '127.0.0.1',
      port: parseInt(env('CONSOLE_PORT') || String(raw.server?.port || 3080), 10),
    },
    minimem: {
      base_url: env('MINIMEM_BASE_URL') || raw.minimem?.base_url || 'http://127.0.0.1:6677',
      data_dir: expandHome(env('MINIMEM_DATA_DIR') || raw.minimem?.data_dir || '~/.minimem'),
      api_token: env(raw.minimem?.api_token_env || 'MINIMEM_API_TOKEN') || '',
    },
    llm: {
      provider: raw.llm?.provider || 'openai-compatible',
      base_url: env('MINIMEM_LLM_BASE_URL') || raw.llm?.base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api_key: env(raw.llm?.api_key_env || 'MINIMEM_LLM_API_KEY') || env('MINIMEM_LLM_API_KEY') || raw.llm?.api_key || '',
      model: env('MINIMEM_LLM_MODEL') || raw.llm?.model || 'qwen-plus',
      temperature: raw.llm?.temperature ?? 0.7,
      max_tokens: raw.llm?.max_tokens ?? 4096,
    },
    storage: {
      data_dir: expandHome(env('CONSOLE_DATA_DIR') || raw.storage?.data_dir || '~/.minimem-console'),
      db_name: raw.storage?.db_name || 'console.db',
    },
    pipeline: {
      output_dir: expandHome(env('PIPELINE_OUTPUT_DIR') || raw.pipeline?.output_dir || '~/.minimem-console/reports'),
    },
    smtp: {
      enabled: (env('SMTP_ENABLED') || String(raw.smtp?.enabled || false)) === 'true',
      host: env('SMTP_HOST') || raw.smtp?.host || '',
      port: parseInt(env('SMTP_PORT') || String(raw.smtp?.port || 465), 10),
      secure: (env('SMTP_SECURE') || String(raw.smtp?.secure ?? true)) === 'true',
      user: env(raw.smtp?.user_env || 'SMTP_USER') || '',
      pass: env(raw.smtp?.pass_env || 'SMTP_PASS') || '',
      from_address: env('SMTP_FROM') || raw.smtp?.from_address || '',
      from_name: raw.smtp?.from_name || 'MiniMem Console',
    },
  };

  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) return loadConfig();
  return _config;
}

// ── 工具函数 ──

function env(key: string): string {
  return process.env[key] || '';
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
