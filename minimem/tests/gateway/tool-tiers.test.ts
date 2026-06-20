import { describe, it, expect } from 'vitest';
import { shouldExposeTool, getExposedTools, CORE_TOOLS, ADVANCED_TOOLS, EXPERIMENTAL_TOOLS, type ToolExposure } from '../../src/adapters/gateway/tool-tiers.js';

describe('TODO-040: MCP Tools 分级', () => {
  describe('shouldExposeTool', () => {
    it('core tools should always be exposed regardless of level', () => {
      for (const tool of CORE_TOOLS) {
        expect(shouldExposeTool(tool, { exposure_level: 'core' })).toBe(true);
        expect(shouldExposeTool(tool, { exposure_level: 'advanced' })).toBe(true);
        expect(shouldExposeTool(tool, { exposure_level: 'experimental' })).toBe(true);
        expect(shouldExposeTool(tool, {})).toBe(true); // 默认 core
      }
    });

    it('advanced tools should NOT be exposed at core level', () => {
      for (const tool of ADVANCED_TOOLS) {
        expect(shouldExposeTool(tool, { exposure_level: 'core' })).toBe(false);
        expect(shouldExposeTool(tool, {})).toBe(false);
      }
    });

    it('advanced tools should be exposed at advanced level', () => {
      for (const tool of ADVANCED_TOOLS) {
        expect(shouldExposeTool(tool, { exposure_level: 'advanced' })).toBe(true);
        expect(shouldExposeTool(tool, { exposure_level: 'experimental' })).toBe(true);
      }
    });

    it('experimental tools should only be exposed at experimental level', () => {
      for (const tool of EXPERIMENTAL_TOOLS) {
        expect(shouldExposeTool(tool, { exposure_level: 'core' })).toBe(false);
        expect(shouldExposeTool(tool, { exposure_level: 'advanced' })).toBe(false);
        expect(shouldExposeTool(tool, { exposure_level: 'experimental' })).toBe(true);
      }
    });

    it('standard tools (non-categorized) should follow advanced', () => {
      // recall_about, load_surfaces 等是 standard 类
      expect(shouldExposeTool('recall_about', { exposure_level: 'core' })).toBe(false);
      expect(shouldExposeTool('recall_about', { exposure_level: 'advanced' })).toBe(true);
      expect(shouldExposeTool('load_surfaces', { exposure_level: 'core' })).toBe(false);
      expect(shouldExposeTool('load_surfaces', { exposure_level: 'advanced' })).toBe(true);
    });

    it('disabled list should override everything (force hide)', () => {
      // 即使是 core tool，被 disabled 也隐藏
      expect(shouldExposeTool('add_memory', { disabled: ['add_memory'] })).toBe(false);
      // experimental tool 在 experimental level + disabled 也隐藏
      expect(shouldExposeTool('trigger_inspiration', {
        exposure_level: 'experimental',
        disabled: ['trigger_inspiration'],
      })).toBe(false);
    });

    it('enabled list should override exposure_level (force show)', () => {
      // experimental tool 在 core level + enabled 也暴露
      expect(shouldExposeTool('trigger_inspiration', {
        exposure_level: 'core',
        enabled: ['trigger_inspiration'],
      })).toBe(true);
      // advanced tool 在 core level + enabled 也暴露
      expect(shouldExposeTool('surface_append', {
        exposure_level: 'core',
        enabled: ['surface_append'],
      })).toBe(true);
    });

    it('disabled should take precedence over enabled', () => {
      expect(shouldExposeTool('add_memory', {
        enabled: ['add_memory'],
        disabled: ['add_memory'],
      })).toBe(false);
    });

    it('unknown tool name should follow standard (advanced) behavior', () => {
      expect(shouldExposeTool('unknown_tool', { exposure_level: 'core' })).toBe(false);
      expect(shouldExposeTool('unknown_tool', { exposure_level: 'advanced' })).toBe(true);
    });
  });

  describe('getExposedTools', () => {
    it('core level should expose 6 core tools', () => {
      const exposed = getExposedTools({ exposure_level: 'core' });
      expect(exposed.length).toBe(6);
      for (const tool of CORE_TOOLS) {
        expect(exposed).toContain(tool);
      }
    });

    it('advanced level should expose core + advanced + standard', () => {
      const exposed = getExposedTools({ exposure_level: 'advanced' });
      // 6 core + 12 advanced + 14 standard = 32
      expect(exposed.length).toBe(32);
      // 不含 experimental
      for (const tool of EXPERIMENTAL_TOOLS) {
        expect(exposed).not.toContain(tool);
      }
    });

    it('experimental level should expose all 44', () => {
      const exposed = getExposedTools({ exposure_level: 'experimental' });
      expect(exposed.length).toBe(44);
    });

    it('default (no config) should be core level = 6 tools', () => {
      const exposed = getExposedTools({});
      expect(exposed.length).toBe(6);
    });
  });

  describe('tier counts', () => {
    it('should have exactly 6 core tools', () => {
      expect(CORE_TOOLS.size).toBe(6);
    });

    it('should have exactly 12 advanced tools', () => {
      expect(ADVANCED_TOOLS.size).toBe(12);
    });

    it('should have exactly 12 experimental tools', () => {
      expect(EXPERIMENTAL_TOOLS.size).toBe(12);
    });
  });
});
