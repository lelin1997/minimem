// ============================================================
// MiniMem — File Watcher Connector (TODO-022.3)
// ============================================================
// 监听文件系统变化，将新增/修改的文件内容写入 MiniMem 记忆

import { watch, readFileSync, statSync, existsSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { getLogger } from '../common/logger.js';
import type { Connector, ConnectorInfo, ConnectorStatus, EventHandler, ConnectorEvent } from './base.js';

const log = getLogger('connectors:file-watcher');

/**
 * File Watcher 连接器配置
 */
export interface FileWatcherConnectorConfig {
  /** 连接器名称 */
  name: string;
  /** 监听的目录路径列表 */
  watchDirs: string[];
  /** 允许的文件扩展名（空数组 = 所有） */
  extensions: string[];
  /** 最大文件大小（字节）— 超过的文件不处理 */
  maxFileSizeBytes: number;
  /** 防抖延迟（毫秒）— 避免频繁变更重复触发 */
  debounceMs: number;
  /** 是否递归监听子目录 */
  recursive: boolean;
  /** 来源标签 */
  sourceTag: string;
}

const DEFAULT_FILE_WATCHER_CONFIG: FileWatcherConnectorConfig = {
  name: 'file-watcher',
  watchDirs: [],
  extensions: ['.md', '.txt', '.log'],
  maxFileSizeBytes: 100_000,  // 100KB
  debounceMs: 2000,
  recursive: true,
  sourceTag: 'file-watcher',
};

/**
 * File Watcher 连接器
 *
 * 监听指定目录的文件变化，当文件新增或修改时，
 * 读取内容并作为 ConnectorEvent 交给 handler 处理。
 */
export class FileWatcherConnector implements Connector {
  readonly name: string;
  readonly type = 'file-watcher';
  private _status: ConnectorStatus = 'idle';
  private config: FileWatcherConnectorConfig;
  private handlers: EventHandler[] = [];
  private watchers: ReturnType<typeof watch>[] = [];
  private _eventsReceived = 0;
  private _eventsProcessed = 0;
  private _lastEventAt: string | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config?: Partial<FileWatcherConnectorConfig>) {
    this.config = { ...DEFAULT_FILE_WATCHER_CONFIG, ...config };
    this.name = this.config.name;
  }

  get status(): ConnectorStatus {
    return this._status;
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    if (this._status === 'running') return;

    if (this.config.watchDirs.length === 0) {
      log.warn({ name: this.name }, 'No watch directories configured, file-watcher idle');
      this._status = 'idle';
      return;
    }

    for (const dir of this.config.watchDirs) {
      const resolved = resolve(dir);
      if (!existsSync(resolved)) {
        log.warn({ dir: resolved }, 'Watch directory does not exist, skipping');
        continue;
      }

      try {
        const watcher = watch(resolved, {
          recursive: this.config.recursive,
        }, (eventType, filename) => {
          if (!filename) return;
          this.handleFileChange(resolved, filename, eventType);
        });

        this.watchers.push(watcher);
        log.info({ dir: resolved, recursive: this.config.recursive }, 'Watching directory');
      } catch (err) {
        log.error({ err, dir: resolved }, 'Failed to watch directory');
      }
    }

    if (this.watchers.length > 0) {
      this._status = 'running';
      log.info({ name: this.name, dirs: this.config.watchDirs.length }, 'File watcher connector started');
    } else {
      this._status = 'error';
      log.warn({ name: this.name }, 'No directories could be watched');
    }
  }

  async stop(): Promise<void> {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    // 清理防抖 timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this._status = 'stopped';
    log.info({ name: this.name }, 'File watcher connector stopped');
  }

  getInfo(): ConnectorInfo {
    return {
      name: this.name,
      type: this.type,
      status: this._status,
      eventsReceived: this._eventsReceived,
      eventsProcessed: this._eventsProcessed,
      lastEventAt: this._lastEventAt,
      config: {
        watchDirs: this.config.watchDirs,
        extensions: this.config.extensions,
        maxFileSizeBytes: this.config.maxFileSizeBytes,
        recursive: this.config.recursive,
      },
    };
  }

  // ── 内部方法 ──

  private handleFileChange(baseDir: string, filename: string, eventType: string): void {
    const fullPath = resolve(baseDir, filename);
    const ext = extname(filename).toLowerCase();

    // 扩展名过滤
    if (this.config.extensions.length > 0 && !this.config.extensions.includes(ext)) {
      return;
    }

    // 忽略隐藏文件和临时文件
    const base = basename(filename);
    if (base.startsWith('.') || base.endsWith('~') || base.endsWith('.tmp')) {
      return;
    }

    // 防抖：同一文件在 debounceMs 内的多次变更只处理最后一次
    const existing = this.debounceTimers.get(fullPath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(fullPath, setTimeout(() => {
      this.debounceTimers.delete(fullPath);
      this.processFileChange(fullPath, eventType).catch(err => {
        log.warn({ err, path: fullPath }, 'File change processing error');
      });
    }, this.config.debounceMs));
  }

  private async processFileChange(fullPath: string, eventType: string): Promise<void> {
    try {
      if (!existsSync(fullPath)) {
        log.debug({ path: fullPath }, 'File no longer exists (deleted)');
        return;
      }

      const stat = statSync(fullPath);
      if (!stat.isFile()) return;

      // 大小限制
      if (stat.size > this.config.maxFileSizeBytes) {
        log.debug({ path: fullPath, size: stat.size }, 'File too large, skipping');
        return;
      }

      const content = readFileSync(fullPath, 'utf-8');
      if (!content.trim()) return;

      const event: ConnectorEvent = {
        source: this.config.sourceTag,
        type: eventType === 'rename' ? 'file_created' : 'file_modified',
        content: content,
        metadata: {
          path: fullPath,
          filename: basename(fullPath),
          extension: extname(fullPath),
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
        },
        timestamp: new Date().toISOString(),
      };

      this._eventsReceived++;

      for (const handler of this.handlers) {
        try {
          await handler(event);
          this._eventsProcessed++;
        } catch (err) {
          log.warn({ err, path: fullPath }, 'File watcher handler error');
        }
      }

      this._lastEventAt = event.timestamp;
      log.debug({ path: fullPath, eventType }, 'File change event processed');
    } catch (err) {
      log.warn({ err, path: fullPath }, 'Failed to process file change');
    }
  }
}
