// ============================================================
// MiniMem — Dream 类型定义 (domain 层共享)
// ============================================================
// A02: 从 dream-engine.ts 提取, 供 domain 各模块 + app 编排层共享

import type { ModelTier } from '../ports/llm-client.js';
import type { SurfaceFileName } from '../../common/types.js';

export type DreamMode = 'daily' | 'weekly';

export interface DreamOptions {
  mode: DreamMode;
  phases?: number[];
  domain?: string;
}

export interface CompileProfile {
  extractFacts: number;
  distillObservations: number;
  promoteToMentalModels: number;
  compileQueue: number;
}

export interface DreamProfile_Dream {
  seedCount: number;
  vectorWalkSteps: number;
  vectorWalkBreadth: number;
  graphDepth: number;
  graphMaxNodes: number;
  maxPairs: number;
  llmTier: ModelTier;
  llmTemperature: number;
  maxDreamIterations: number;
}

export type { DreamProfile_Dream as DreamDreamProfile };

export interface DreamProfile {
  compile: CompileProfile;
  dream: DreamProfile_Dream;
  surfaceFiles: SurfaceFileName[];
}

export interface DreamSession {
  session_id: string;
  mode: DreamMode;
  phases: number[];
  status: 'running' | 'completed' | 'failed' | 'partial' | 'skipped';
  report: import('./dream-report.js').DreamReport | null;
  error?: string;
}
