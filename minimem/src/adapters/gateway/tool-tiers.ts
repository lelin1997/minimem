// ============================================================
// MiniMem — MCP Tools 分级定义 (TODO-040)
// ============================================================
// 44 个 tool 分三级:
//   core (6)         — 默认暴露，基础记忆读写
//   advanced (12)    — 配置 mcp.tools.exposure_level = 'advanced' 开启
//   experimental (12) — 配置 mcp.tools.exposure_level = 'experimental' 开启
// 剩余为 "other"（special/meta），跟随 advanced 一起暴露
// ============================================================

export type ToolExposure = 'core' | 'advanced' | 'experimental';

// ── 核心 6 个：基础记忆 CRUD + 搜索 ──
export const CORE_TOOLS: ReadonlySet<string> = new Set([
  'add_memory',
  'search_memory',
  'get_relevant_context',
  'get_memory_by_id',
  'list_memories',
  'get_summary',
]);

// ── 高级 12 个：批量、导入导出、Surface 编辑、Dream 触发 ──
export const ADVANCED_TOOLS: ReadonlySet<string> = new Set([
  'add_memories_batch',
  'import_knowledge',
  'update_memory',
  'delete_memory',
  'forget_about',
  'pin_memory',
  'feedback_memory',
  'export_memories',
  'import_memories',
  'surface_append',
  'surface_replace',
  'trigger_dream',
]);

// ── 实验性 12 个：灵感引擎、Onboarding、Person/Domain 管理、Snapshot ──
export const EXPERIMENTAL_TOOLS: ReadonlySet<string> = new Set([
  'get_inspirations',
  'act_on_inspiration',
  'trigger_inspiration',
  'rate_inspiration',
  'dismiss_inspiration',
  'start_onboarding',
  'create_person',
  'update_person',
  'delete_person',
  'create_domain',
  'create_snapshot',
  'diff_memory',
]);

// ── 其余归类为 "standard"（默认跟随 advanced 暴露）──
// 这些是查询类、辅助类 tool，风险低但非核心
// 例: recall_about, load_surfaces, get_surface_file, suggest_surface_update,
//     check_surface_version, get_owner_profile, get_owner_preference,
//     get_person_profile, list_persons, list_domains, get_memory_health,
//     get_belief_health, get_memory_hints, minimem(meta)

/**
 * 根据 exposure_level 判断某个 tool 是否应暴露给 client
 */
export function shouldExposeTool(
  toolName: string,
  config: {
    exposure_level?: ToolExposure;
    enabled?: string[];
    disabled?: string[];
  } = {},
): boolean {
  // 1. disabled 列表优先（最高优先级，强制隐藏）
  if (config.disabled?.includes(toolName)) {
    return false;
  }

  // 2. enabled 列表（强制暴露，覆盖 exposure_level）
  if (config.enabled?.includes(toolName)) {
    return true;
  }

  // 3. 按 exposure_level 分级
  const level = config.exposure_level ?? 'core'; // 默认只暴露 core

  if (CORE_TOOLS.has(toolName)) {
    return true; // core 始终暴露
  }

  if (level === 'advanced' || level === 'experimental') {
    if (ADVANCED_TOOLS.has(toolName)) return true;
    // standard 类（非 core/advanced/experimental 的）跟随 advanced 暴露
    if (!EXPERIMENTAL_TOOLS.has(toolName)) return true;
  }

  if (level === 'experimental') {
    if (EXPERIMENTAL_TOOLS.has(toolName)) return true;
  }

  return false;
}

/**
 * 获取给定 exposure_level 下应暴露的 tool 列表（用于测试/调试）
 */
export function getExposedTools(
  config: {
    exposure_level?: ToolExposure;
    enabled?: string[];
    disabled?: string[];
  } = {},
): string[] {
  const allTools = [
    ...CORE_TOOLS,
    ...ADVANCED_TOOLS,
    ...EXPERIMENTAL_TOOLS,
    // standard 类（非三级分类的）— 这里列全 44 个减去上面 30 个
    'minimem', 'recall_about', 'load_surfaces', 'get_surface_file',
    'suggest_surface_update', 'check_surface_version',
    'get_owner_profile', 'get_owner_preference', 'get_person_profile',
    'list_persons', 'list_domains', 'get_memory_health',
    'get_belief_health', 'get_memory_hints',
  ];
  return allTools.filter(name => shouldExposeTool(name, config));
}
