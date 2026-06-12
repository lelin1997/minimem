// ============================================================
// MiniMem — 备份系统（定时备份 + 保留策略）
// ============================================================

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, cpSync } from 'fs';
import { join, basename, dirname } from 'path';
import { getLogger } from '../common/logger.js';
import { getConfig } from '../config/index.js';

const log = getLogger('store:backup');

/**
 * 创建数据库备份
 */
export function createBackup(dbPath?: string): string | null {
  const config = getConfig();
  const sourcePath = dbPath ?? join(config.storage.data_dir, 'db', 'minimem.db');

  // Issue-30: 增强日志 — 输出实际检查的路径
  log.info({ sourcePath, dataDir: config.storage.data_dir }, 'Starting backup');

  if (!existsSync(sourcePath)) {
    // Issue-30: 增强诊断 — 列出 db 目录下实际存在的文件
    const dataDir = config.storage.data_dir;
    const dbDir = join(dataDir, 'db');
    const dbDirExists = existsSync(dbDir);
    const dbDirContents = dbDirExists ? readdirSync(dbDir) : [];
    log.error({
      sourcePath,
      dataDir,
      dbDirExists,
      dbDirContents,
    }, 'Database file not found, skipping backup — check config.storage.data_dir');
    return null;
  }

  const backupDir = join(config.storage.data_dir, 'backups');
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `minimem-${timestamp}.db`;
  const backupPath = join(backupDir, backupName);

  try {
    copyFileSync(sourcePath, backupPath);

    // 如果有 WAL 文件也一起备份
    const walPath = `${sourcePath}-wal`;
    if (existsSync(walPath)) {
      copyFileSync(walPath, `${backupPath}-wal`);
    }

    log.info({ backupPath, backupName }, 'Backup created');

    // R-014: 备份 data/ 下关键子目录
    try {
      const dataDirs = ['vectors', 'dreams', 'surfaces'];
      const backupDataDir = join(backupDir, `data-${timestamp}`);
      mkdirSync(backupDataDir, { recursive: true });

      for (const subDir of dataDirs) {
        const srcDir = join(config.storage.data_dir, subDir);
        if (existsSync(srcDir)) {
          const destDir = join(backupDataDir, subDir);
          cpSync(srcDir, destDir, { recursive: true });
        }
      }
      log.info({ backupDataDir }, 'Data directories backed up');
    } catch (dataDirErr) {
      log.warn({ err: dataDirErr }, 'Data directory backup failed (non-critical)');
    }

    // 执行保留策略
    applyRetentionPolicy(backupDir, config.backup.retention_count);

    return backupPath;
  } catch (err) {
    log.error({ err, sourcePath }, 'Backup failed');
    return null;
  }
}

/**
 * 保留策略：保留最近 N 个备份
 */
function applyRetentionPolicy(backupDir: string, retentionCount: number): void {
  try {
    const files = readdirSync(backupDir)
      .filter(f => f.startsWith('minimem-') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: join(backupDir, f),
        mtime: statSync(join(backupDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime); // 最新在前

    if (files.length <= retentionCount) return;

    const toDelete = files.slice(retentionCount);
    for (const file of toDelete) {
      unlinkSync(file.path);
      // 删除对应的 WAL 备份
      const walPath = `${file.path}-wal`;
      if (existsSync(walPath)) unlinkSync(walPath);
      log.debug({ file: file.name }, 'Old backup removed');
    }

    log.info({ removed: toDelete.length, kept: retentionCount }, 'Retention policy applied');
  } catch (err) {
    log.warn({ err }, 'Retention policy failed');
  }
}

/**
 * 列出所有备份
 */
export function listBackups(): Array<{ name: string; path: string; size: number; created_at: string }> {
  const config = getConfig();
  const backupDir = join(config.storage.data_dir, 'backups');

  if (!existsSync(backupDir)) return [];

  return readdirSync(backupDir)
    .filter(f => f.startsWith('minimem-') && f.endsWith('.db'))
    .map(f => {
      const fullPath = join(backupDir, f);
      const stats = statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        size: stats.size,
        created_at: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * 恢复备份
 */
export function restoreBackup(backupPath: string, targetPath?: string): boolean {
  const config = getConfig();
  const target = targetPath ?? join(config.storage.data_dir, 'db', 'minimem.db');

  if (!existsSync(backupPath)) {
    log.error({ backupPath }, 'Backup file not found');
    return false;
  }

  try {
    // 恢复 .db
    copyFileSync(backupPath, target);

    // 恢复 WAL
    const walBackup = `${backupPath}-wal`;
    if (existsSync(walBackup)) {
      copyFileSync(walBackup, `${target}-wal`);
    }

    // 恢复 data/ 子目录（vectors, dreams, surfaces）
    const timestamp = extractTimestamp(backupPath);
    if (timestamp) {
      const backupDataDir = join(dirname(backupPath), `data-${timestamp}`);
      if (existsSync(backupDataDir)) {
        const dataDirs = ['vectors', 'dreams', 'surfaces'];
        for (const subDir of dataDirs) {
          const srcDir = join(backupDataDir, subDir);
          const destDir = join(config.storage.data_dir, subDir);
          if (existsSync(srcDir)) {
            cpSync(srcDir, destDir, { recursive: true });
          }
        }
        log.info({ backupDataDir }, 'Data directories restored');
      } else {
        log.warn({ backupDataDir }, 'Data backup directory not found, only DB restored');
      }
    }

    log.info({ backupPath, target }, 'Backup restored');
    return true;
  } catch (err) {
    log.error({ err }, 'Backup restoration failed');
    return false;
  }
}

/**
 * 获取备份统计
 */
export function getBackupStats(): {
  total_backups: number;
  total_size_bytes: number;
  latest_backup: string | null;
  oldest_backup: string | null;
} {
  const backups = listBackups();
  const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

  return {
    total_backups: backups.length,
    total_size_bytes: totalSize,
    latest_backup: backups[0]?.created_at ?? null,
    oldest_backup: backups[backups.length - 1]?.created_at ?? null,
  };
}

// ═══════════════ 备份完整性校验 ═══════════════

/**
 * 校验备份文件完整性
 */
export function verifyBackup(backupPath: string): {
  valid: boolean;
  dbSize: number;
  hasWal: boolean;
  hasDataDirs: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!existsSync(backupPath)) {
    return { valid: false, dbSize: 0, hasWal: false, hasDataDirs: false, issues: ['DB file not found'] };
  }

  const dbSize = statSync(backupPath).size;
  if (dbSize < 4096) issues.push('DB file suspiciously small');

  const hasWal = existsSync(`${backupPath}-wal`);

  const timestamp = extractTimestamp(backupPath);
  const hasDataDirs = timestamp
    ? existsSync(join(dirname(backupPath), `data-${timestamp}`))
    : false;

  if (!hasDataDirs) issues.push('Data directories backup missing');

  return {
    valid: issues.length === 0,
    dbSize,
    hasWal,
    hasDataDirs,
    issues,
  };
}

// ═══════════════ 内部工具 ═══════════════

/**
 * 从备份文件名中提取时间戳
 * 文件名格式: minimem-YYYY-MM-DDTHH-MM-SS.db
 */
function extractTimestamp(backupPath: string): string | null {
  const name = basename(backupPath);
  const match = name.match(/^minimem-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.db$/);
  return match ? match[1] : null;
}
