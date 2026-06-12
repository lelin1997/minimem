// ============================================================
// MiniMem — 定时调度器（node-cron based）
// ============================================================

import { schedule, ScheduledTask } from 'node-cron';
import { getLogger } from '../common/logger.js';
import { now } from '../common/utils.js';
import { getDb } from '../store/database.js';
import { getConfig } from '../config/index.js';
import { runLightGC, runStandardGC, runDeepGC, runEmergencyGC, getTemperatureDistribution } from '../lifecycle/index.js';
import { runCompression } from '../lifecycle/compressor.js';
import { createSnapshot } from '../version/snapshot.js';
import { createBackup, verifyBackup } from '../store/backup.js';

const log = getLogger('scheduler');

const tasks: Map<string, ScheduledTask> = new Map();

// R-011: 简单互斥锁，防止 Dream 和 GC 并发执行
// TODO(P4): 当前为进程内变量锁，单进程足够。多进程部署时需升级为
//   SQLite Advisory Lock 或 proper-lockfile 文件锁，参见 REPAIR.md Issue-4。
let _taskLock: string | null = null;
const _lockQueue: Array<{ name: string; resolve: () => void }> = [];

async function acquireTaskLock(name: string): Promise<boolean> {
  if (_taskLock === null) {
    _taskLock = name;
    return true;
  }
  // Issue-18: 等待锁释放，超时从 5 分钟增加到 15 分钟
  // 原因：weekly dream 可能运行 >5 分钟导致后续任务超时
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      log.warn({ name, heldBy: _taskLock }, 'Task lock acquisition timed out (15min)');
      resolve(false);
    }, 15 * 60 * 1000);

    _lockQueue.push({
      name,
      resolve: () => {
        clearTimeout(timeout);
        _taskLock = name;
        resolve(true);
      },
    });
  });
}

function releaseTaskLock(name: string): void {
  if (_taskLock !== name) return;
  _taskLock = null;
  if (_lockQueue.length > 0) {
    const next = _lockQueue.shift()!;
    next.resolve();
  }
}

export interface SchedulerConfig {
  enabled: boolean;
  dreaming: {
    daily_cron: string;
    weekly_cron: string;
    auto_trigger_threshold: number;  // REQ-003: 统一命名（原 auto_trigger_count）
  };
  gc: {
    light_cron: string;
    standard_cron: string;
    deep_cron: string;
  };
  summary: {
    daily_cron: string;
  };
  backup: {
    cron: string;
  };
}

const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  dreaming: {
    daily_cron: '0 3 * * *',       // 凌晨 3 点
    weekly_cron: '0 4 * * 0',      // 周日凌晨 4 点
    auto_trigger_threshold: 50,    // REQ-003: 统一命名（原 auto_trigger_count）
  },
  gc: {
    light_cron: '0 */6 * * *',     // 每 6 小时
    standard_cron: '0 4 * * *',    // 每天凌晨 4 点
    deep_cron: '0 5 * * 0',        // 每周日凌晨 5 点
  },
  summary: {
    daily_cron: '0 18 * * 1-5',    // 工作日 18:00
  },
  backup: {
    cron: '0 2 * * *',             // 凌晨 2 点
  },
};

/**
 * 启动所有定时任务
 */
export function startScheduler(config?: Partial<SchedulerConfig>): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) {
    log.info('Scheduler disabled');
    return;
  }

  // ── GC 调度 ──

  registerTask('gc:light', cfg.gc.light_cron, async () => {
    log.info('Running scheduled light GC');
    const locked = await acquireTaskLock('gc:light');
    if (!locked) { log.warn('gc:light skipped, lock unavailable'); return; }
    try {
      const result = runLightGC();
      log.info({ result }, 'Light GC completed');

      // 检查是否需要紧急 GC
      const dist = getTemperatureDistribution();
      const total = Object.values(dist).reduce((a, b) => a + b, 0);
      if (total > 160000) { // 80% of 200K
        log.warn({ total }, 'Storage nearing quota, running emergency GC');
        await runEmergencyGC();
      }
    } catch (err) {
      log.error({ err }, 'Light GC failed');
    } finally {
      releaseTaskLock('gc:light');
    }
  });

  registerTask('gc:standard', cfg.gc.standard_cron, async () => {
    log.info('Running scheduled standard GC');
    const locked = await acquireTaskLock('gc:standard');
    if (!locked) { log.warn('gc:standard skipped, lock unavailable'); return; }
    try {
      const result = runStandardGC();
      log.info({ result }, 'Standard GC completed');
    } catch (err) {
      log.error({ err }, 'Standard GC failed');
    } finally {
      releaseTaskLock('gc:standard');
    }
  });

  registerTask('gc:deep', cfg.gc.deep_cron, async () => {
    log.info('Running scheduled deep GC');
    const locked = await acquireTaskLock('gc:deep');
    if (!locked) { log.warn('gc:deep skipped, lock unavailable'); return; }
    try {
      const result = await runDeepGC();
      log.info({ result }, 'Deep GC completed');
    } catch (err) {
      log.error({ err }, 'Deep GC failed');
    } finally {
      releaseTaskLock('gc:deep');
    }
  });

  // ── 做梦调度 ──

  registerTask('dream:daily', cfg.dreaming.daily_cron, async () => {
    // Issue-18: 周日跳过 daily dream，让位给 weekly dream
    const today = new Date();
    if (today.getDay() === 0) {
      log.info('Skipping daily dream on Sunday (weekly dream will run instead)');
      return;
    }
    log.info('Running scheduled daily dream');
    const locked = await acquireTaskLock('dream:daily');
    if (!locked) { log.warn('dream:daily skipped, lock unavailable'); return; }
    try {
      const { triggerDream } = await import('../modules/dream/dream-engine.js');
      const session = await triggerDream({ mode: 'daily' });
      log.info({ sessionId: session.session_id, status: session.status }, 'Daily dream completed');
    } catch (err) {
      log.error({ err }, 'Daily dream failed');
    } finally {
      releaseTaskLock('dream:daily');
    }
  });

  registerTask('dream:weekly', cfg.dreaming.weekly_cron, async () => {
    log.info('Running scheduled weekly deep dream');
    const locked = await acquireTaskLock('dream:weekly');
    if (!locked) { log.warn('dream:weekly skipped, lock unavailable'); return; }
    try {
      const { triggerDream } = await import('../modules/dream/dream-engine.js');
      const session = await triggerDream({ mode: 'weekly' });
      log.info({ sessionId: session.session_id, status: session.status }, 'Weekly deep dream completed');
    } catch (err) {
      log.error({ err }, 'Weekly dream failed');
    } finally {
      releaseTaskLock('dream:weekly');
    }
  });

  // ── 日终总结 ──

  registerTask('summary:daily', cfg.summary.daily_cron, () => {
    log.info('Running daily summary generation');
    try {
      import('../modules/work/daily-summary.js').then(mod => {
        mod.generateDailySummary().then(() => {
          log.info('Daily summary completed');
        }).catch(err => {
          log.error({ err }, 'Daily summary generation failed');
        });
      });
    } catch (err) {
      log.error({ err }, 'Daily summary failed');
    }
  });

  // ── 自动备份 ──

  registerTask('backup:daily', cfg.backup.cron, () => {
    log.info('Running scheduled backup');
    try {
      // 先做逻辑快照（记录统计点）
      createSnapshot({ label: `backup-${new Date().toISOString().slice(0, 10)}`, trigger: 'auto' });
      // 再做物理备份（复制实际文件：.db + WAL + data/vectors,dreams,surfaces）
      const backupPath = createBackup();
      if (backupPath) {
        // Issue-30: 校验备份完整性
        const verification = verifyBackup(backupPath);
        if (verification.valid) {
          log.info({ backupPath, dbSize: verification.dbSize }, 'Physical backup created and verified ✅');
        } else {
          log.warn({ backupPath, issues: verification.issues }, 'Backup created but verification failed ⚠️');
        }
      } else {
        // Issue-30: 升级为 error，null 意味着没有产出备份
        log.error('Physical backup returned null — no backup was created!');
      }
    } catch (err) {
      log.error({ err }, 'Backup failed');
    }
  });

  // ── 压缩管线（挂在标准 GC 之后） ──

  registerTask('compression', cfg.gc.standard_cron, async () => {
    log.info('Running scheduled compression pipeline');
    try {
      const result = await runCompression();
      log.info({ result }, 'Compression completed');
    } catch (err) {
      log.error({ err }, 'Compression pipeline failed');
    }
  });

  // ── REQ-007: Surface Files 独立更新任务 ──

  registerTask('surface:auto-process', '0 */6 * * *', async () => {
    log.info('Running scheduled surface update queue processing');
    try {
      const { processUpdateQueue } = await import('../surface/index.js');
      const processed = await processUpdateQueue();
      log.info({ processed }, 'Surface auto-process completed');
    } catch (err) {
      log.error({ err }, 'Surface auto-process failed');
    }
  });

  // ── T-003.6: Embedding 回填独立定时任务 ──

  registerTask('embedding:backfill', '30 */6 * * *', async () => {
    log.info('Running scheduled embedding backfill');
    try {
      const db = getDb();
      const pending = db.prepare(
        "SELECT COUNT(*) as count FROM compile_queue WHERE status = 'pending' AND source_type = 'embedding_backfill'"
      ).get() as { count: number };

      if (pending.count === 0) {
        log.debug('No pending embedding backfills');
        return;
      }

      log.info({ pending: pending.count }, 'Processing embedding backfills');
      // 复用 compiler 中的 processCompileQueue（它现在能处理 embedding_backfill 类型）
      const { runCompile } = await import('../modules/dream/compiler.js');
      // 只运行编译队列部分（extractFacts/distill/promote 都设为 0）
      await runCompile({
        extractFacts: 0,
        distillObservations: 0,
        promoteToMentalModels: 0,
        compileQueue: pending.count,
      });
      log.info('Embedding backfill completed');
    } catch (err) {
      log.error({ err }, 'Embedding backfill task failed');
    }
  });

  log.info({ taskCount: tasks.size }, 'Scheduler started');

  // Issue-32: 根据配置决定是否启动补偿
  const globalConfig = getConfig();
  const compensationEnabled = globalConfig.scheduler.startup_compensation;
  const compensationDelay = globalConfig.scheduler.compensation_delay_ms;

  if (compensationEnabled) {
    log.info({ delayMs: compensationDelay }, 'Startup compensation enabled, scheduling check');
    setTimeout(async () => {
      try {
        const result = await runStartupCompensation();
        if (result.compensated.length > 0) {
          log.info({ compensated: result.compensated },
            '🔄 Startup compensation: tasks executed');
        }
      } catch (err) {
        log.error({ err }, 'Startup compensation failed');
      }
    }, compensationDelay);
  } else {
    log.info('Startup compensation disabled by config (scheduler.startup_compensation = false)');
  }
}

/**
 * 停止所有定时任务
 */
export function stopScheduler(): void {
  for (const [name, task] of tasks) {
    task.stop();
    log.debug({ name }, 'Task stopped');
  }
  tasks.clear();
  log.info('Scheduler stopped');
}

/**
 * 列出所有已注册的任务
 */
export function listScheduledTasks(): Array<{ name: string; running: boolean }> {
  return Array.from(tasks.entries()).map(([name]) => ({
    name,
    running: true, // node-cron tasks are running once scheduled
  }));
}

/**
 * 新记忆计数追踪（用于自动触发做梦）
 */
let newMemoryCount = 0;

export function incrementMemoryCount(): void {
  newMemoryCount++;
  // REQ-003: 使用运行时配置，而非 DEFAULT_CONFIG 硬编码
  const config = getConfig();
  const baseThreshold = config.dreaming.auto_trigger_threshold;

  // T-002.5: 分级阈值 — 冷启动期降低触发门槛，加速首次 Dream
  let effectiveThreshold = baseThreshold;
  try {
    const db = getDb();
    const totalCount = (db.prepare("SELECT COUNT(*) as count FROM experiences WHERE branch = 'main'").get() as { count: number }).count;
    if (totalCount < 100) {
      effectiveThreshold = Math.min(baseThreshold, 10);
    } else if (totalCount < 500) {
      effectiveThreshold = Math.min(baseThreshold, 25);
    }
  } catch {
    // DB 查询失败时使用原始阈值
  }

  if (newMemoryCount >= effectiveThreshold) {
    log.info({ count: newMemoryCount, baseThreshold, effectiveThreshold }, 'Auto-trigger dream threshold reached');
    // 重置计数
    newMemoryCount = 0;
    // 触发做梦（异步，不阻塞主流程）
    try {
      import('../modules/dream/dream-engine.js').then(mod => {
        mod.triggerDream({ mode: 'daily' }).catch(err => {
          log.error({ err }, 'Auto-trigger dream execution failed');
        });
      });
    } catch (err) {
      log.error({ err }, 'Auto-trigger dream failed');
    }
  }
}

export function getMemoryCount(): number {
  return newMemoryCount;
}

export function resetMemoryCount(): void {
  newMemoryCount = 0;
}

// ── 内部 ──

function registerTask(name: string, cronExpr: string, handler: () => void | Promise<void>): void {
  const task = schedule(cronExpr, async () => {
    try {
      await handler();
      recordTaskRun(name, 'ok');       // Issue-32: 记录成功
    } catch (err) {
      log.error({ name, err }, 'Scheduled task failed');
      recordTaskRun(name, 'failed');   // Issue-32: 记录失败
    }
  });
  tasks.set(name, task);
  log.debug({ name, cron: cronExpr }, 'Task registered');
}

// ═══════════════ Issue-32: 调度器状态持久化 & 启动补偿 ═══════════════

/**
 * 记录任务执行时间到 SQLite
 */
function recordTaskRun(name: string, status: string): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO scheduler_state (task_name, last_run, status, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(name, now(), status, now());
  } catch (err) {
    log.warn({ err, name }, 'Failed to record task run (non-critical)');
  }
}

/**
 * 获取任务上次执行记录
 */
function getLastRun(name: string): { last_run: string; status: string } | null {
  try {
    const db = getDb();
    return db.prepare(
      'SELECT last_run, status FROM scheduler_state WHERE task_name = ?'
    ).get(name) as { last_run: string; status: string } | null;
  } catch {
    return null;
  }
}

// ── 补偿规则定义 ──

interface CompensationRule {
  taskName: string;
  /** 超过多少小时未执行就需要补偿 */
  maxStaleHours: number;
  /** 补偿执行的函数 */
  compensate: () => Promise<void>;
  /** 补偿执行的优先级（数字越小越先执行） */
  priority: number;
}

const COMPENSATION_RULES: CompensationRule[] = [
  {
    taskName: 'backup:daily',
    maxStaleHours: 25,
    compensate: async () => {
      log.info('🔄 Compensating: backup:daily');
      createSnapshot({ label: `backup-compensate-${new Date().toISOString().slice(0, 10)}`, trigger: 'auto' });
      const backupPath = createBackup();
      if (backupPath) {
        const verification = verifyBackup(backupPath);
        log.info({ backupPath, valid: verification.valid }, 'Compensation backup completed');
      } else {
        log.error('Compensation backup returned null');
      }
    },
    priority: 1,
  },
  {
    taskName: 'dream:daily',
    maxStaleHours: 25,
    compensate: async () => {
      log.info('🔄 Compensating: dream:daily');
      const { triggerDream } = await import('../modules/dream/dream-engine.js');
      await triggerDream({ mode: 'daily' });
    },
    priority: 2,
  },
  {
    taskName: 'dream:weekly',
    maxStaleHours: 8 * 24, // 超过 8 天
    compensate: async () => {
      log.info('🔄 Compensating: dream:weekly');
      const { triggerDream } = await import('../modules/dream/dream-engine.js');
      await triggerDream({ mode: 'weekly' });
    },
    priority: 3,
  },
  {
    taskName: 'gc:standard',
    maxStaleHours: 25,
    compensate: async () => {
      log.info('🔄 Compensating: gc:standard');
      runStandardGC();
    },
    priority: 4,
  },
];

/**
 * 启动时检查并补偿过期的定时任务
 *
 * 在 startScheduler() 末尾异步调用（不阻塞启动）
 */
export async function runStartupCompensation(): Promise<{
  compensated: string[];
  skipped: string[];
}> {
  const compensated: string[] = [];
  const skipped: string[] = [];

  // 按优先级排序
  const rules = [...COMPENSATION_RULES].sort((a, b) => a.priority - b.priority);

  for (const rule of rules) {
    const lastRun = getLastRun(rule.taskName);

    if (!lastRun) {
      // 从未运行过 → 需要补偿
      log.info({ taskName: rule.taskName }, 'Task has never run, compensating');
    } else {
      const hoursSince = (Date.now() - new Date(lastRun.last_run).getTime()) / (1000 * 60 * 60);

      if (hoursSince < rule.maxStaleHours) {
        skipped.push(rule.taskName);
        log.debug({ taskName: rule.taskName, hoursSince: Math.round(hoursSince) },
          'Task recently run, no compensation needed');
        continue;
      }

      log.info({ taskName: rule.taskName, hoursSince: Math.round(hoursSince), maxStale: rule.maxStaleHours },
        'Task overdue, compensating');
    }

    try {
      const locked = await acquireTaskLock(`compensate:${rule.taskName}`);
      if (!locked) {
        log.warn({ taskName: rule.taskName }, 'Compensation skipped: lock unavailable');
        skipped.push(rule.taskName);
        continue;
      }

      await rule.compensate();
      recordTaskRun(rule.taskName, 'ok');
      compensated.push(rule.taskName);

      releaseTaskLock(`compensate:${rule.taskName}`);
    } catch (err) {
      log.error({ err, taskName: rule.taskName }, 'Compensation failed');
      recordTaskRun(rule.taskName, 'failed');
      releaseTaskLock(`compensate:${rule.taskName}`);
    }
  }

  log.info({ compensated, skipped }, '🔄 Startup compensation completed');
  return { compensated, skipped };
}
