// ============================================================
// MiniMem — Dream Engine: Phase 2.5 — Knowledge Audit
// ============================================================
// 在 Karpathy Compile 之后执行，对知识页面做质量审计

import { getLogger } from '../../common/logger.js';
import { getLLM } from '../../llm/client.js';
import { getAllKnowledgePages, updateKnowledgePageContent, updateKnowledgePageMeta } from '../../store/knowledge-pages/page-store.js';
import { now } from '../../common/utils.js';

const log = getLogger('dream:knowledge-auditor');

export interface KnowledgeAuditResult {
  pages_audited: number;
  trimmed: number;
  split: number;
  archived: number;
  issues_found: number;
  duration_ms: number;
}

interface AuditIssue {
  page_slug: string;
  page_title: string;
  issues: string[];
  action: 'keep' | 'trim' | 'split' | 'archive';
  reason: string;
}

const AUDIT_SAMPLE_SIZE = 8;
const MAX_LINKS_THRESHOLD = 8;
const MAX_CONTENT_LENGTH = 3000;
const MAX_SPECULATION_RATIO = 0.3;

export async function runKnowledgeAudit(): Promise<KnowledgeAuditResult> {
  const start = Date.now();
  const result: KnowledgeAuditResult = {
    pages_audited: 0, trimmed: 0, split: 0, archived: 0, issues_found: 0, duration_ms: 0,
  };

  const llm = getLLM();
  if (!llm.isAvailable) {
    log.info('LLM not available, skipping knowledge audit');
    result.duration_ms = Date.now() - start;
    return result;
  }

  const allPages = getAllKnowledgePages();
  if (allPages.length === 0) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  const sampleSize = Math.min(AUDIT_SAMPLE_SIZE, allPages.length);
  const sampled = shuffleArray(allPages).slice(0, sampleSize);

  // 规则化快速检查（不需要 LLM）
  const autoIssues: Array<{ pageId: string; slug: string; title: string; issue: string; action: string }> = [];

  for (const page of sampled) {
    const linkCount = (page.content.match(/\[\[/g) || []).length;
    if (linkCount > MAX_LINKS_THRESHOLD) {
      autoIssues.push({
        pageId: page.id, slug: page.slug, title: page.title,
        issue: `包含 ${linkCount} 个 [[link]]，超过阈值 ${MAX_LINKS_THRESHOLD}，可能存在过度泛化`,
        action: 'trim',
      });
    }

    if (page.content.length > MAX_CONTENT_LENGTH) {
      autoIssues.push({
        pageId: page.id, slug: page.slug, title: page.title,
        issue: `内容 ${page.content.length} 字符，超过建议长度 ${MAX_CONTENT_LENGTH}，建议拆分`,
        action: 'split',
      });
    }

    const speculationCount = (page.content.match(/\[推测\]/g) || []).length;
    const totalLines = page.content.split('\n').filter(l => l.trim()).length;
    if (totalLines > 0 && speculationCount / totalLines > MAX_SPECULATION_RATIO) {
      autoIssues.push({
        pageId: page.id, slug: page.slug, title: page.title,
        issue: `推测内容占比 ${(speculationCount / totalLines * 100).toFixed(0)}%，超过阈值`,
        action: 'trim',
      });
    }
  }

  // 优先审查已自动发现问题的页面
  const autoIssueSlugs = new Set(autoIssues.map(i => i.slug));
  const toAudit = sampled.filter(p => autoIssueSlugs.has(p.slug));
  for (const page of sampled) {
    if (!autoIssueSlugs.has(page.slug) && toAudit.length < 5) toAudit.push(page);
  }

  if (toAudit.length > 0) {
    try {
      const pagesText = toAudit.map((p, i) =>
        `[${i + 1}] slug: ${p.slug} | title: ${p.title}\n内容预览: ${p.content.slice(0, 500)}`
      ).join('\n\n---\n\n');

      const auditResult = await llm.chatJson<{ pages: AuditIssue[] }>({
        messages: [
          {
            role: 'system',
            content: `你是严谨的知识审计员（iWiki 质量审查）。审查知识页面质量。

对每个页面判断：
1. 内容是否可直接追溯到原始记忆？还是大量推测/隐喻？
2. 是否有过度推测/哲学化论述？（如"A的端口关闭象征B的防御姿态"）
3. 跨页面引用是否实质性（技术依赖/因果），还是概念类比？
4. 是否过于臃肿需要拆分？
5. 是否有明显矛盾或过时内容？

行动：keep（质量良好）/ trim（删除推测段落）/ split（拆分）/ archive（归档）

返回 JSON: { "pages": [{ "page_slug": "...", "page_title": "...", "issues": ["问题"], "action": "keep|trim|split|archive", "reason": "..." }] }`,
          },
          {
            role: 'user',
            content: `审查 ${toAudit.length} 个知识页面：\n\n${pagesText}`,
          },
        ],
        tier: 'medium',
        temperature: 0.3,
        fallback: { pages: [] },
      });

      result.pages_audited = toAudit.length;

      for (const pageIssue of auditResult.pages || []) {
        if (pageIssue.action === 'keep') continue;
        result.issues_found += pageIssue.issues.length;

        const page = toAudit.find(p => p.slug === pageIssue.page_slug);
        if (!page) continue;

        try {
          switch (pageIssue.action) {
            case 'trim': {
              const auditNote = `> ⚠️ 审计标记 (${now().slice(0, 10)}): ${pageIssue.reason}\n> 待处理: ${pageIssue.issues.join('; ')}\n\n`;
              updateKnowledgePageContent(page.id, auditNote + page.content);
              // confidence 已通过审计标记内容体现，无需单独设置 meta
              result.trimmed++;
              break;
            }
            case 'archive': {
              updateKnowledgePageMeta(page.id, { summary: `[已归档] ${pageIssue.reason}` });
              result.archived++;
              break;
            }
            case 'split': {
              const auditNote = `> ⚠️ 审计标记 (${now().slice(0, 10)}): 建议拆分 — ${pageIssue.reason}\n\n`;
              updateKnowledgePageContent(page.id, auditNote + page.content);
              result.split++;
              break;
            }
          }
        } catch (err) {
          log.warn({ err, slug: page.slug }, 'Failed to apply audit action');
        }
      }

      log.info(result, 'Knowledge audit complete');
    } catch (err) {
      log.warn({ err }, 'LLM knowledge audit failed (non-critical)');
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
