// ============================================================
// MiniMem — Preprocessor 框架
// ============================================================
// 职责：为所有多模态输入提供统一的前置转换器框架
// 输入可以是 URL、图片、文件路径等，统一转换为 PreprocessResult
// 然后交给 perception.ts 的 ingestMemory() 写入 L1

import { getLogger } from '../../common/logger.js';
import type { ContentType } from '../../common/types.js';

const log = getLogger('core:preprocessor');

// ── 预处理结果 ──

export interface PreprocessResult {
  /** 转换后的纯文本内容 */
  content: string;
  /** 内容类型标识 */
  contentType: ContentType;
  /** 元信息（来源 URL、标题、文件名等） */
  metadata: Record<string, unknown>;
}

// ── Preprocessor 接口 ──

export interface Preprocessor {
  /** 预处理器名称（用于日志） */
  readonly name: string;
  /**
   * 预处理输入，返回一个或多个结果（支持分块场景）
   */
  preprocess(input: MultimodalInput): Promise<PreprocessResult | PreprocessResult[]>;
}

// ── 多模态输入 ──

export interface MultimodalInput {
  /** 纯文本内容（与其他字段互斥） */
  content?: string;
  /** URL 地址 */
  url?: string;
  /** 图片 URL（Base64 或 HTTP） */
  image_url?: string;
  /** 本地文件路径 */
  file_path?: string;
  /** 用户提供的上下文说明 */
  context?: string;
  /** 内容来源标识 */
  source: string;
  /** 标签 */
  tags?: string[];
  /** 相关人物 */
  participants?: string[];
  /** 重要性 */
  importance?: number;
  /** 领域 */
  domain?: string;
  /** URL 提取模式 */
  extract_mode?: 'readability' | 'full' | 'summary';
}

// ── InputRouter: 根据输入字段路由到对应 Preprocessor ──

export class InputRouter {
  private preprocessors: Map<string, Preprocessor> = new Map();

  /**
   * 注册一个 Preprocessor
   */
  register(type: string, preprocessor: Preprocessor): void {
    this.preprocessors.set(type, preprocessor);
    log.debug({ type, name: preprocessor.name }, 'Registered preprocessor');
  }

  /**
   * 根据输入字段检测输入类型
   */
  detectType(input: MultimodalInput): 'text' | 'url' | 'image' | 'file' {
    if (input.url) return 'url';
    if (input.image_url) return 'image';
    if (input.file_path) return 'file';
    return 'text';
  }

  /**
   * 路由输入到对应的 Preprocessor 并执行
   *
   * - 纯文本输入直接 bypass（返回 null，调用方走原有 ingestMemory 路径）
   * - 其他类型路由到已注册的 Preprocessor
   */
  async route(input: MultimodalInput): Promise<PreprocessResult[] | null> {
    const type = this.detectType(input);

    // 纯文本 bypass
    if (type === 'text') {
      log.debug('Text input detected, bypassing preprocessor');
      return null;
    }

    const preprocessor = this.preprocessors.get(type);
    if (!preprocessor) {
      throw new Error(`No preprocessor registered for input type: ${type}`);
    }

    log.info({ type, preprocessor: preprocessor.name }, 'Routing to preprocessor');

    const result = await preprocessor.preprocess(input);

    // 统一为数组
    const results = Array.isArray(result) ? result : [result];

    log.info({
      type,
      preprocessor: preprocessor.name,
      resultCount: results.length,
      totalLength: results.reduce((sum, r) => sum + r.content.length, 0),
    }, 'Preprocessor completed');

    return results;
  }
}

// ── 单例 ──

let _router: InputRouter | null = null;

/**
 * 获取全局 InputRouter 实例（懒初始化，首次调用时注册所有 Preprocessors）
 */
export function getInputRouter(): InputRouter {
  if (!_router) {
    _router = new InputRouter();
    // 延迟注册，避免循环依赖
    registerPreprocessors(_router);
  }
  return _router;
}

/**
 * 注册所有已实现的 Preprocessors
 */
function registerPreprocessors(router: InputRouter): void {
  // Phase 1: URL Preprocessor
  try {
    const { UrlPreprocessor } = require('./url-preprocessor.js');
    router.register('url', new UrlPreprocessor());
  } catch (err) {
    log.warn({ err }, 'Failed to register UrlPreprocessor');
  }

  // Phase 2: File Preprocessor
  try {
    const { FilePreprocessor } = require('./file-preprocessor.js');
    router.register('file', new FilePreprocessor());
  } catch (err) {
    log.warn({ err }, 'Failed to register FilePreprocessor');
  }

  // Phase 3: Image Preprocessor
  try {
    const { ImagePreprocessor } = require('./image-preprocessor.js');
    router.register('image', new ImagePreprocessor());
  } catch (err) {
    log.warn({ err }, 'Failed to register ImagePreprocessor');
  }
}

/**
 * 重置单例（用于测试）
 */
export function resetInputRouter(): void {
  _router = null;
}
