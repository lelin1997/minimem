// ============================================================
// MiniMem — Dream Engine (domain 层类型定义 + re-export)
// ============================================================
// A02: 编排逻辑已迁移到 app/dream-orchestrator.ts
// 本文件保留类型定义 (DreamMode/DreamProfile/DreamSession 等)
// 和对 app 层 triggerDream 的 re-export (向后兼容)
//
// domain 层的纯逻辑函数在各自模块:
// - auditor.ts → runAudit()
// - compiler.ts → runCompile()
// - dreamer.ts → runDream()
// - cleaner.ts → runCleanup()
// - knowledge-auditor.ts → runKnowledgeAudit()
// - quality-score.ts → calculateDreamQuality()

// 类型定义 (domain 层共享)
export type { DreamMode, DreamOptions, CompileProfile, DreamProfile, DreamProfile_Dream, DreamSession } from './dream-types.js';

// A02: triggerDream 编排逻辑迁移到 app 层, 这里 re-export 保持向后兼容
// 调用方 (scheduler / rest-api / mcp-server) 不需要改 import 路径
// 注意: domain → app 是单向依赖违规, 但 re-export 是过渡方案
// 后续调用方应直接 import app/dream-orchestrator.js
export { triggerDream, getDreamReportMarkdown } from '../../app/dream-orchestrator.js';
