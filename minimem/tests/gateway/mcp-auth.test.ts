// ============================================================
// MiniMem — MCP 认证 & 鉴权测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  authorizeToolCall,
  TOOL_RISK_MAP,
  DEFAULT_TRUSTED_CLIENT,
} from '../../src/gateway/mcp-auth.js';
import type { Client, PermissionLevel } from '../../src/common/types.js';

// ── 测试用 Client 工厂 ──

function makeClient(overrides: Partial<Client> = {}): Partial<Client> {
  return {
    id: 'test-client',
    name: 'test',
    permission_level: 'standard' as PermissionLevel,
    can_write: true,
    can_dream: false,
    can_snapshot: false,
    read_layers: ['L1', 'L2', 'L3', 'L4'],
    ...overrides,
  };
}

describe('MCP Auth', () => {
  // ── Tool 风险分级 ──

  describe('TOOL_RISK_MAP', () => {
    it('应覆盖所有 31 个 MCP Tools', () => {
      const ALL_TOOLS = [
        'add_memory', 'add_memories_batch', 'search_memory', 'recall_about',
        'get_relevant_context', 'get_memory_by_id', 'list_memories',
        'update_memory', 'delete_memory', 'forget_about', 'pin_memory',
        'feedback_memory', 'export_memories', 'import_memories',
        'get_owner_profile', 'get_owner_preference', 'get_person_profile',
        'load_surfaces', 'get_surface_file', 'suggest_surface_update',
        'check_surface_version', 'trigger_dream', 'get_summary',
        'create_snapshot', 'diff_memory', 'start_onboarding',
        'get_memory_health', 'list_persons', 'create_person',
        'update_person', 'delete_person',
      ];

      for (const tool of ALL_TOOLS) {
        expect(TOOL_RISK_MAP[tool], `Missing risk level for tool: ${tool}`).toBeDefined();
      }
    });

    it('read 级工具应全部为只读操作', () => {
      const readTools = Object.entries(TOOL_RISK_MAP)
        .filter(([_, level]) => level === 'read')
        .map(([name]) => name);

      // read 类 Tool 不应包含任何写入/删除操作
      for (const tool of readTools) {
        expect(tool).not.toContain('delete');
        expect(tool).not.toContain('forget');
        expect(tool).not.toContain('import');
      }
    });

    it('dangerous 级应包含所有不可逆操作', () => {
      expect(TOOL_RISK_MAP['delete_memory']).toBe('dangerous');
      expect(TOOL_RISK_MAP['forget_about']).toBe('dangerous');
      expect(TOOL_RISK_MAP['delete_person']).toBe('dangerous');
      expect(TOOL_RISK_MAP['export_memories']).toBe('dangerous');
      expect(TOOL_RISK_MAP['import_memories']).toBe('dangerous');
      expect(TOOL_RISK_MAP['trigger_dream']).toBe('dangerous');
      expect(TOOL_RISK_MAP['create_snapshot']).toBe('dangerous');
    });
  });

  // ── 鉴权逻辑 ──

  describe('authorizeToolCall', () => {
    // --- trusted client ---

    it('trusted client 应可调用所有 Tool', () => {
      const trustedClient = makeClient({ permission_level: 'trusted', can_write: true, can_dream: true, can_snapshot: true });

      for (const toolName of Object.keys(TOOL_RISK_MAP)) {
        expect(() => authorizeToolCall(trustedClient, toolName)).not.toThrow();
      }
    });

    // --- standard client ---

    it('standard client 应可调用 read 级 Tool', () => {
      const standardClient = makeClient({ permission_level: 'standard', can_write: true });

      expect(() => authorizeToolCall(standardClient, 'search_memory')).not.toThrow();
      expect(() => authorizeToolCall(standardClient, 'list_memories')).not.toThrow();
      expect(() => authorizeToolCall(standardClient, 'get_memory_health')).not.toThrow();
    });

    it('standard client 应可调用 write 级 Tool', () => {
      const standardClient = makeClient({ permission_level: 'standard', can_write: true });

      expect(() => authorizeToolCall(standardClient, 'add_memory')).not.toThrow();
      expect(() => authorizeToolCall(standardClient, 'update_memory')).not.toThrow();
      expect(() => authorizeToolCall(standardClient, 'feedback_memory')).not.toThrow();
    });

    it('standard client 不应调用 dangerous 级 Tool', () => {
      const standardClient = makeClient({ permission_level: 'standard', can_write: true });

      expect(() => authorizeToolCall(standardClient, 'delete_memory')).toThrow('requires \'trusted\' permission');
      expect(() => authorizeToolCall(standardClient, 'forget_about')).toThrow('requires \'trusted\' permission');
      expect(() => authorizeToolCall(standardClient, 'trigger_dream')).toThrow('requires \'trusted\' permission');
      expect(() => authorizeToolCall(standardClient, 'export_memories')).toThrow('requires \'trusted\' permission');
    });

    // --- readonly client ---

    it('readonly client 应只能调用 read 级 Tool', () => {
      const readonlyClient = makeClient({ permission_level: 'readonly', can_write: false });

      expect(() => authorizeToolCall(readonlyClient, 'search_memory')).not.toThrow();
      expect(() => authorizeToolCall(readonlyClient, 'get_memory_by_id')).not.toThrow();
    });

    it('readonly client 不应调用 write 级 Tool', () => {
      const readonlyClient = makeClient({ permission_level: 'readonly', can_write: false });

      expect(() => authorizeToolCall(readonlyClient, 'add_memory')).toThrow();
      expect(() => authorizeToolCall(readonlyClient, 'update_memory')).toThrow();
    });

    it('readonly client 不应调用 dangerous 级 Tool', () => {
      const readonlyClient = makeClient({ permission_level: 'readonly', can_write: false });

      expect(() => authorizeToolCall(readonlyClient, 'delete_memory')).toThrow();
      expect(() => authorizeToolCall(readonlyClient, 'export_memories')).toThrow();
    });

    // --- 细粒度权限检查 ---

    it('standard client 无 can_write 应被写入 Tool 拒绝', () => {
      const noWriteClient = makeClient({ permission_level: 'standard', can_write: false });

      expect(() => authorizeToolCall(noWriteClient, 'add_memory')).toThrow('write permission');
    });

    it('trusted client 无 can_dream 应被 trigger_dream 拒绝', () => {
      const noDreamClient = makeClient({ permission_level: 'trusted', can_write: true, can_dream: false });

      expect(() => authorizeToolCall(noDreamClient, 'trigger_dream')).toThrow('dream permission');
    });

    it('trusted client 无 can_snapshot 应被 create_snapshot 拒绝', () => {
      const noSnapshotClient = makeClient({ permission_level: 'trusted', can_write: true, can_dream: true, can_snapshot: false });

      expect(() => authorizeToolCall(noSnapshotClient, 'create_snapshot')).toThrow('snapshot permission');
    });

    // --- 未知 Tool ---

    it('未知 Tool 应要求 trusted 权限', () => {
      const standardClient = makeClient({ permission_level: 'standard' });

      expect(() => authorizeToolCall(standardClient, 'unknown_tool')).toThrow();
    });

    it('trusted client 可调用未知 Tool', () => {
      const trustedClient = makeClient({ permission_level: 'trusted', can_write: true, can_dream: true, can_snapshot: true });

      expect(() => authorizeToolCall(trustedClient, 'unknown_tool')).not.toThrow();
    });
  });

  // ── 默认 Client ──

  describe('DEFAULT_TRUSTED_CLIENT', () => {
    it('应有 trusted 权限和全部能力', () => {
      expect(DEFAULT_TRUSTED_CLIENT.permission_level).toBe('trusted');
      expect(DEFAULT_TRUSTED_CLIENT.can_write).toBe(true);
      expect(DEFAULT_TRUSTED_CLIENT.can_dream).toBe(true);
      expect(DEFAULT_TRUSTED_CLIENT.can_snapshot).toBe(true);
    });

    it('应能访问所有层级', () => {
      expect(DEFAULT_TRUSTED_CLIENT.read_layers).toEqual(['L1', 'L2', 'L3', 'L4']);
    });
  });
});
