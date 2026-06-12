// ============================================================
// MiniMem — Dream Engine: 做梦报告生成
// ============================================================

import { getLogger } from '../../common/logger.js';
import type { AuditResult } from './auditor.js';
import type { CompileResult } from './compiler.js';
import type { DreamResult } from './dreamer.js';
import type { CleanupResult } from './cleaner.js';
import type { InspirationEngineResult } from './inspiration-engine.js';

const log = getLogger('dream:report');

export interface DreamReport {
  date: string;
  session_id: string;
  duration_ms: number;

  consolidation: {
    memories_audited: number;
    l1_to_l2_extracted: number;
    l2_to_l3_induced: number;
    l3_to_l4_proposed: number;
    conflicts_found: number;
  };

  dream: {
    narrative_summary: string;
    new_connections: number;
    graph_discoveries: number;
    insights_count: number;
  };

  cleanup: {
    gc_deleted: number;
    gc_compressed: number;
    surface_synced: number;
    surface_updates: number;
  };

  version_control: {
    pre_snapshot_id: string;
    post_snapshot_id: string;
    diff_summary: string;
    auto_merged: boolean;
  };

  pages: {
    created: number;
    updated: number;
    lint_issues: number;
  };

  // MINIMEM-002: 灵感引擎统计
  inspiration: {
    sparks_generated: number;
    cross_pollinations: number;
    habits_detected: number;
    incubations_performed: number;
    matured: number;
    archived_expired: number;
  };

  morning_briefing: string;
}

/**
 * 从各阶段结果生成完整的做梦报告
 */
export function generateDreamReport(
  sessionId: string,
  preSnapshotId: string,
  totalDuration: number,
  audit: AuditResult,
  compile: CompileResult,
  dream: DreamResult,
  cleanup: CleanupResult,
  inspiration?: InspirationEngineResult,
): DreamReport {
  const report: DreamReport = {
    date: new Date().toISOString(),
    session_id: sessionId,
    duration_ms: totalDuration,

    consolidation: {
      memories_audited: audit.total_new_memories,
      l1_to_l2_extracted: compile.l1_to_l2,
      l2_to_l3_induced: compile.l2_to_l3,
      l3_to_l4_proposed: compile.l3_to_l4,
      conflicts_found: audit.conflicts.length,
    },

    dream: {
      narrative_summary: dream.narrative,
      new_connections: dream.new_connections,
      graph_discoveries: dream.graph_discoveries,
      insights_count: dream.insights_to_l3,
    },

    cleanup: {
      gc_deleted: cleanup.gc_deleted,
      gc_compressed: cleanup.gc_compressed,
      surface_synced: cleanup.surface_synced,
      surface_updates: cleanup.surface_updates,
    },

    version_control: {
      pre_snapshot_id: preSnapshotId,
      post_snapshot_id: cleanup.post_snapshot_id,
      diff_summary: cleanup.diff?.summary ?? '无变化',
      auto_merged: cleanup.merge !== null,
    },

    pages: {
      created: compile.pages_created,
      updated: compile.pages_updated,
      lint_issues: audit.lint_issues.length,
    },

    inspiration: {
      sparks_generated: inspiration?.sparks_generated ?? 0,
      cross_pollinations: inspiration?.cross_pollinations ?? 0,
      habits_detected: inspiration?.habits_detected ?? 0,
      incubations_performed: inspiration?.incubations_performed ?? 0,
      matured: inspiration?.matured ?? 0,
      archived_expired: inspiration?.archived_expired ?? 0,
    },

    morning_briefing: generateBriefing(audit, compile, dream, cleanup, inspiration),
  };

  log.info({ sessionId, duration: totalDuration }, 'Dream report generated');
  return report;
}

/**
 * 将报告转为 Markdown 格式
 */
export function dreamReportToMarkdown(report: DreamReport): string {
  const lines: string[] = [];

  lines.push(`# 🌙 做梦报告 — ${report.date.slice(0, 10)}`);
  lines.push('');
  lines.push(`> Session: ${report.session_id}`);
  lines.push(`> 耗时: ${(report.duration_ms / 1000).toFixed(1)}s`);
  lines.push('');

  lines.push('## 📊 巩固统计');
  lines.push('');
  lines.push(`| 指标 | 数值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 审计记忆数 | ${report.consolidation.memories_audited} |`);
  lines.push(`| L1→L2 事实提取 | ${report.consolidation.l1_to_l2_extracted} |`);
  lines.push(`| L2→L3 观察归纳 | ${report.consolidation.l2_to_l3_induced} |`);
  lines.push(`| L3→L4 模型提议 | ${report.consolidation.l3_to_l4_proposed} |`);
  lines.push(`| 发现冲突 | ${report.consolidation.conflicts_found} |`);
  lines.push('');

  lines.push('## 💭 梦境');
  lines.push('');
  lines.push(report.dream.narrative_summary);
  lines.push('');
  lines.push(`- 新建连接: ${report.dream.new_connections}`);
  lines.push(`- 图遍历发现: ${report.dream.graph_discoveries}`);
  lines.push(`- 产出洞察: ${report.dream.insights_count}`);
  lines.push('');

  lines.push('## 🧹 清理');
  lines.push('');
  lines.push(`- GC 删除: ${report.cleanup.gc_deleted}`);
  lines.push(`- GC 压缩: ${report.cleanup.gc_compressed}`);
  lines.push(`- Surface 同步: ${report.cleanup.surface_synced}`);
  lines.push(`- Surface 更新: ${report.cleanup.surface_updates}`);
  lines.push('');

  lines.push('## 📸 版本控制');
  lines.push('');
  lines.push(`- 前快照: \`${report.version_control.pre_snapshot_id}\``);
  lines.push(`- 后快照: \`${report.version_control.post_snapshot_id}\``);
  lines.push(`- 自动合并: ${report.version_control.auto_merged ? '✅' : '❌'}`);
  lines.push('');
  lines.push('### Diff 摘要');
  lines.push('```');
  lines.push(report.version_control.diff_summary);
  lines.push('```');
  lines.push('');

  lines.push('## 📝 知识页面');
  lines.push('');
  lines.push(`- 新建: ${report.pages.created}`);
  lines.push(`- 更新: ${report.pages.updated}`);
  lines.push(`- Lint 问题: ${report.pages.lint_issues}`);
  lines.push('');

  // MINIMEM-002: 灵感引擎统计
  const ins = report.inspiration;
  if (ins.sparks_generated > 0 || ins.incubations_performed > 0 || ins.matured > 0) {
    lines.push('## 💡 灵感引擎');
    lines.push('');
    lines.push(`| 指标 | 数值 |`);
    lines.push(`|------|------|`);
    lines.push(`| 新灵感火花 | ${ins.sparks_generated} |`);
    lines.push(`| 跨域碰撞 | ${ins.cross_pollinations} |`);
    lines.push(`| 习惯检测 | ${ins.habits_detected} |`);
    lines.push(`| 孵化执行 | ${ins.incubations_performed} |`);
    lines.push(`| 成熟灵感 | ${ins.matured} |`);
    lines.push(`| 过期归档 | ${ins.archived_expired} |`);
    lines.push('');
  }

  lines.push('## ☀️ 晨间简报');
  lines.push('');
  lines.push(report.morning_briefing);

  return lines.join('\n');
}

function generateBriefing(
  audit: AuditResult,
  compile: CompileResult,
  dream: DreamResult,
  cleanup: CleanupResult,
  inspiration?: InspirationEngineResult,
): string {
  const parts: string[] = [];

  if (audit.total_new_memories > 0) {
    parts.push(`昨天你积累了 ${audit.total_new_memories} 条新记忆`);
    if (audit.critical.length > 0) {
      parts.push(`其中 ${audit.critical.length} 条非常重要`);
    }
  }

  if (compile.l1_to_l2 > 0 || compile.l2_to_l3 > 0) {
    parts.push(`我从中提取了 ${compile.l1_to_l2} 个事实、归纳出 ${compile.l2_to_l3} 条观察`);
  }

  if (compile.l3_to_l4 > 0) {
    parts.push(`形成了 ${compile.l3_to_l4} 条新的心智模型`);
  }

  if (dream.new_connections > 0) {
    parts.push(`做梦时发现了 ${dream.new_connections} 个有趣的关联`);
  }

  // MINIMEM-002: 灵感引擎简报
  if (inspiration) {
    if (inspiration.sparks_generated > 0) {
      parts.push(`灵感引擎产生了 ${inspiration.sparks_generated} 个新火花`);
    }
    if (inspiration.matured > 0) {
      parts.push(`有 ${inspiration.matured} 条灵感已成熟，值得关注`);
    }
    if (inspiration.habits_detected > 0) {
      parts.push(`检测到 ${inspiration.habits_detected} 个重复行为模式`);
    }
  }

  if (audit.conflicts.length > 0) {
    parts.push(`注意：发现 ${audit.conflicts.length} 处知识冲突需要关注`);
  }

  if (compile.pages_created > 0 || compile.pages_updated > 0) {
    parts.push(`更新了 ${compile.pages_created + compile.pages_updated} 个知识页面`);
  }

  return parts.length > 0
    ? parts.join('。') + '。'
    : '一切正常，记忆系统运行良好。';
}
