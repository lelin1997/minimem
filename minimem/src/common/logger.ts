// ============================================================
// MiniMem — 结构化日志系统
// ============================================================

import pino from 'pino';
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { MiniMemConfig } from './types.js';

let _logger: pino.Logger | null = null;

/**
 * 获取日志文件目录
 */
function getLogDir(dataDir?: string): string {
  const dir = dataDir ?? join(process.env.HOME ?? '~', '.minimem');
  return join(dir, 'logs');
}

/**
 * 旋转日志文件：保留最近 N 个文件，删除旧的
 */
function rotateLogFiles(logDir: string, maxFiles: number, maxSizeMb: number = 10): void {
  try {
    if (!existsSync(logDir)) return;

    const logFiles = readdirSync(logDir)
      .filter(f => f.startsWith('minimem-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: join(logDir, f),
        mtime: statSync(join(logDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime); // 最新在前

    if (logFiles.length <= maxFiles) return;

    const toDelete = logFiles.slice(maxFiles);
    for (const file of toDelete) {
      unlinkSync(file.path);
    }
  } catch {
    // 旋转失败不影响启动
  }
}

/**
 * 初始化日志器
 *
 * Issue-29 修复：无论 NODE_ENV 如何，都写日志文件。
 * - 开发环境: pino-pretty → stdout + 文件
 * - 生产环境: JSON → stdout + 文件
 */
export function initLogger(config?: Partial<MiniMemConfig['storage']['log']>, dataDir?: string): pino.Logger {
  const level = config?.level ?? 'info';
  const maxFiles = config?.max_files ?? 10;
  const maxSizeMb = config?.max_size_mb ?? 10;

  const isDev = process.env.NODE_ENV !== 'production';

  // Issue-29: 始终写日志文件，无论 NODE_ENV
  const logDir = getLogDir(dataDir);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  // 旋转旧日志文件（按数量和大小）
  rotateLogFiles(logDir, maxFiles, maxSizeMb);

  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logFilePath = join(logDir, `minimem-${dateStr}.log`);

  const targets: pino.TransportTargetOptions[] = [
    // 始终写文件（Issue-29 核心修复）
    {
      target: 'pino/file',
      options: { destination: logFilePath, mkdir: true, append: true },
      level,
    },
  ];

  if (isDev) {
    // 开发模式：pino-pretty → stdout
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      level,
    });
  } else {
    // 生产模式：原始 JSON → stdout
    targets.push({
      target: 'pino/file',
      options: { destination: 1 }, // stdout
      level,
    });
  }

  _logger = pino({
    name: 'minimem',
    level,
    serializers: {
      err: pino.stdSerializers.err,
    },
    transport: { targets },
  });

  _logger.info({ logFile: logFilePath, isDev }, 'Logger initialized — log file active');

  return _logger;
}

/**
 * 获取子日志器（带模块标签）
 */
export function getLogger(module: string): pino.Logger {
  if (!_logger) {
    _logger = initLogger();
  }
  return _logger.child({ module });
}

/**
 * 获取根日志器
 */
export function getRootLogger(): pino.Logger {
  if (!_logger) {
    _logger = initLogger();
  }
  return _logger;
}
