#!/usr/bin/env node
/**
 * MiniMem — D04: 旧知识页面数据修复脚本
 * ============================================
 * 一次性运行: 扫描全部 knowledge_pages
 * 1. 清除堆积的审计标记 (同一页面 >1 条 ⚠️ 审计标记)
 * 2. 对 lint_status=missing/stale 的页面, 入队 lint_finding 触发 processLintFindings
 * 3. 修复 MiniMem 页面描述 (如果是错误的"多机迁移系统")
 *
 * 用法: node scripts/fix-legacy-pages.js
 * 或:   pnpm tsx scripts/fix-legacy-pages.ts
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const dbPath = join(homedir(), '.minimem', 'db', 'minimem.db');
const db = new Database(dbPath);

console.log('=== D04: 旧知识页面修复脚本 ===');
console.log(`DB: ${dbPath}`);
console.log('');

// ── 1. 统计现状 ──
const total = db.prepare('SELECT COUNT(*) as c FROM knowledge_pages').get().c;
const stacked = db.prepare(`
  SELECT id, title, content FROM knowledge_pages
  WHERE length(content) - length(replace(content, '⚠️ 审计标记', '')) > length('⚠️ 审计标记')
`).all() as Array<{ id: string; title: string; content: string }>;

console.log(`总页面数: ${total}`);
console.log(`审计标记堆积页面: ${stacked.length}`);
console.log('');

// ── 2. 清除堆积的审计标记 ──
let cleanedCount = 0;
for (const page of stacked) {
  // 清除所有 ⚠️ 审计标记 + 待处理 行 (开头连续的)
  const cleaned = page.content
    .replace(/^(> ⚠️ 审计标记[^\n]*\n> 待处理[^\n]*\n*)+/gm, '')
    .replace(/^(> ⚠️ 审计标记[^\n]*\n*)+/gm, '')
    .trim();

  if (cleaned !== page.content) {
    db.prepare('UPDATE knowledge_pages SET content = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(cleaned, page.id);
    cleanedCount++;
    console.log(`  ✓ 清除审计标记: ${page.title}`);
  }
}
console.log(`\n清除审计标记: ${cleanedCount} 个页面`);

// ── 3. 修复 MiniMem 页面错误描述 ──
const minimemPage = db.prepare("SELECT id, content FROM knowledge_pages WHERE slug = 'minimem'").get() as { id: string; content: string } | undefined;
if (minimemPage && minimemPage.content.includes('多机内存与迁移系统')) {
  console.log('\n⚠️ MiniMem 页面描述错误 (多机迁移系统), 需要重新编译');
  // 入队 lint_finding 让 processLintFindings 修复
  db.prepare(`
    INSERT INTO compile_queue (id, source_type, content, target_page, status, priority, created_at)
    VALUES (?, 'lint_finding', ?, 'minimem', 'pending', 9, datetime('now'))
  `).run(`fix-minimem-description-${Date.now()}`, 'Page "MiniMem" (minimem): 描述错误, 写成了"多机迁移系统", 实际是个人 AI 记忆系统');
  console.log('  ✓ 已入队 lint_finding 触发修复');
}

// ── 4. 对 lint_status=missing 的页面入队 lint_finding ──
const missingPages = db.prepare(`
  SELECT id, slug, title FROM knowledge_pages WHERE lint_status IN ('missing', 'stale') AND status = 'active'
`).all() as Array<{ id: string; slug: string; title: string }>;

console.log(`\nlint_status=missing/stale 的页面: ${missingPages.length}`);

let enqueuedCount = 0;
for (const page of missingPages) {
  // 检查是否已有 pending 的 lint_finding
  const existing = db.prepare(`
    SELECT COUNT(*) as c FROM compile_queue
    WHERE source_type = 'lint_finding' AND target_page = ? AND status = 'pending'
  `).get(page.slug) as { c: number };

  if (existing.c === 0) {
    db.prepare(`
      INSERT INTO compile_queue (id, source_type, content, target_page, status, priority, created_at)
      VALUES (?, 'lint_finding', ?, ?, 'pending', 3, datetime('now'))
    `).run(
      `fix-${page.slug}-${Date.now()}`,
      `Page "${page.title}" (${page.slug}): lint_status=missing, needs audit`,
      page.slug
    );
    enqueuedCount++;
  }
}
console.log(`已入队 lint_finding: ${enqueuedCount} 个页面 (下次 dream 会处理)`);

// ── 5. 统计修复后状态 ──
console.log('\n=== 修复后统计 ===');
const lintStats = db.prepare('SELECT lint_status, COUNT(*) as c FROM knowledge_pages GROUP BY lint_status ORDER BY c DESC').all();
lintStats.forEach((s: any) => console.log(`  ${s.lint_status}: ${s.c}`));

const pendingLint = db.prepare("SELECT COUNT(*) as c FROM compile_queue WHERE source_type = 'lint_finding' AND status = 'pending'").get() as { c: number };
console.log(`\n待处理的 lint_finding: ${pendingLint.c} 条`);
console.log('(下次 dream 的 processLintFindings 会逐步修复)');

db.close();
console.log('\n✅ 修复脚本完成');
