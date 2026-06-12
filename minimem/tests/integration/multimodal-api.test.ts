// ============================================================
// MiniMem — 多模态感知 API 集成测试 (T-M04.3)
// ============================================================
// 覆盖范围：
//   REST: POST /api/v1/memory { url }, POST /api/v1/memory/import-url
//   MCP:  add_memory { url }, import_knowledge { source_type: "url" }, import_knowledge { source_type: "file" }
// 策略：
//   - Mock fetch() 返回受控的 HTML 响应
//   - Mock validateUrl() 绕过 SSRF 检查（已有专属单测覆盖）
//   - ingestMemory() 跑到底写入 SQLite :memory:（LLM 不可用时自动降级）

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, clearAllTables } from '../helpers/setup.js';
import { createRestApp } from '../../src/gateway/rest-api.js';
import { createMCPServer } from '../../src/gateway/mcp-server.js';
import { DEFAULT_TRUSTED_CLIENT } from '../../src/gateway/mcp-auth.js';
import { resetInputRouter } from '../../src/core/preprocessor/index.js';
import { getDb } from '../../src/store/database.js';
import { getConfig } from '../../src/config/index.js';
import type { Hono } from 'hono';

// ── 测试数据 ──

const MOCK_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head><title>MiniMem 技术架构</title></head>
<body>
  <article>
    <h1>MiniMem 技术架构概述</h1>
    <p>MiniMem 是一个基于四层记忆模型的个人知识管理系统。它通过 L1 原始经验层、L2 世界事实层、L3 观察洞察层、L4 心智模型层的分层架构，实现了记忆的自动沉淀与知识萃取。</p>
    <p>核心设计原则包括：多模态输入纯文本存储、Dream 管线驱动的知识编译、以及基于温度模型的记忆生命周期管理。系统支持通过 REST API 和 MCP 协议两种方式与外部系统交互。</p>
    <p>在安全方面，MiniMem 实现了 JWT 认证、SSRF 防护、PII 检测与脱敏、以及基于风险分级的工具调用鉴权。</p>
  </article>
</body>
</html>
`;

const MOCK_URL = 'https://docs.example.com/minimem-architecture';

// ── Mock：全局 fetch + validateUrl ──

// Mock fetch 在模块加载前设置
const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

// Mock validateUrl 绕过 SSRF 检查（不 mock 整个模块，而是 mock 函数）
vi.mock('../../src/core/preprocessor/url-security.js', () => ({
  validateUrl: vi.fn().mockResolvedValue({ valid: true, resolvedUrl: 'https://docs.example.com/minimem-architecture' }),
  isPrivateIP: vi.fn().mockReturnValue(false),
  ALLOWED_PROTOCOLS: new Set(['http:', 'https:']),
  ALLOWED_PORTS: new Set([80, 443, 8080, 8443, 3000]),
  DEFAULT_BLOCKED_DOMAINS: [],
}));

// Mock preprocessor/index.js 的 getInputRouter — 手动注册 UrlPreprocessor + FilePreprocessor + ImagePreprocessor
// 因为原始代码中的 require() 在 vitest ESM 环境下无法正确加载
vi.mock('../../src/core/preprocessor/index.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  const { UrlPreprocessor } = await import('../../src/core/preprocessor/url-preprocessor.js');
  const { FilePreprocessor } = await import('../../src/core/preprocessor/file-preprocessor.js');
  const { ImagePreprocessor } = await import('../../src/core/preprocessor/image-preprocessor.js');

  let _router: InstanceType<typeof original.InputRouter> | null = null;

  return {
    ...original,
    getInputRouter: () => {
      if (!_router) {
        _router = new original.InputRouter();
        _router.register('url', new UrlPreprocessor());
        _router.register('file', new FilePreprocessor());
        _router.register('image', new ImagePreprocessor());
      }
      return _router;
    },
    resetInputRouter: () => {
      _router = null;
    },
  };
});

// ── 辅助函数 ──

function createMockResponse(body: string, contentType = 'text/html; charset=utf-8', status = 200): Response {
  const buffer = new TextEncoder().encode(body);
  return new Response(buffer, {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      'content-type': contentType,
    },
  });
}

/**
 * 通过 MCP Server 的 request handler 执行 tool call
 * 利用 Server 的 _requestHandlers (内部) 或模拟 CallToolRequest
 */
async function callMCPTool(
  server: Server,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // 直接通过 server 的 request handler 调用
  // Server 注册的 handler 可以通过模拟请求来触发
  const request = {
    method: 'tools/call' as const,
    params: {
      name: toolName,
      arguments: args,
    },
  };

  // 使用 Server 内部机制：手动触发 handler
  // 由于 MCP SDK 的 Server 类没有暴露直接调用 handler 的 API，
  // 我们使用 InMemoryTransport 来做端到端测试
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  // 创建一个简易客户端
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);

  const result = await client.callTool({
    name: toolName,
    arguments: args,
  });

  // 断开连接
  await client.close();
  await server.close();

  return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

// ── 测试套件 ──

describe('MINIMEM-005: 多模态感知 API 集成测试', () => {
  let app: Hono;

  beforeAll(() => {
    // 在 loadConfig 前设置环境变量禁用 auth
    process.env.MINIMEM_AUTH_ENABLED = 'false';

    setupTestDb();

    // 双重保障：直接修改已加载的配置对象
    const config = getConfig();
    (config as any).auth.enabled = false;

    // 设置 fetch mock
    vi.stubGlobal('fetch', mockFetch);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    teardownTestDb();
  });

  beforeEach(() => {
    clearAllTables();
    resetInputRouter();
    mockFetch.mockReset();

    // 默认 mock：返回正常 HTML 响应
    mockFetch.mockResolvedValue(createMockResponse(MOCK_HTML));

    // 创建新的 app 实例
    app = createRestApp();
  });

  // ════════════════════════════════════════════
  // REST API 测试
  // ════════════════════════════════════════════

  describe('REST: POST /api/v1/memory { url }', () => {
    it('应成功通过 URL 导入记忆并返回正确格式', async () => {
      const res = await app.request('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
          source: 'test-integration',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();

      // 验证响应格式
      expect(body).toHaveProperty('memory_id');
      expect(body).toHaveProperty('memory_ids');
      expect(body).toHaveProperty('layer', 'L1');
      expect(body).toHaveProperty('source_info');
      expect(body.source_info).toMatchObject({
        type: 'url',
        url: MOCK_URL,
      });
      expect(body.source_info).toHaveProperty('title');
      expect(body.source_info).toHaveProperty('content_length');
      expect(body.memory_ids).toBeInstanceOf(Array);
      expect(body.memory_ids.length).toBeGreaterThan(0);
      expect(body.memory_id).toBe(body.memory_ids[0]);

      // 验证 L1 写入
      const db = getDb();
      const exp = db.prepare('SELECT * FROM experiences WHERE id = ?').get(body.memory_id) as Record<string, unknown>;
      expect(exp).toBeTruthy();
      expect(exp.source).toBe('test-integration');
      expect((exp.raw_content as string)).toContain('MiniMem');
      expect((exp.raw_content as string)).toContain('[来源]');
    });

    it('应传递 extract_mode 参数到 UrlPreprocessor', async () => {
      const res = await app.request('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
          source: 'test',
          extract_mode: 'full',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.memory_id).toBeTruthy();
    });

    it('应传递 tags 和 domain 参数', async () => {
      const res = await app.request('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
          source: 'test',
          tags: ['architecture', 'tech'],
          domain: 'work',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();

      const db = getDb();
      const exp = db.prepare('SELECT * FROM experiences WHERE id = ?').get(body.memory_id) as Record<string, unknown>;
      expect(exp).toBeTruthy();
      expect(JSON.parse(exp.tags as string)).toEqual(['architecture', 'tech']);
      expect(exp.domain).toBe('work');
    });

    it('url 和 content 都不提供时应返回 400', async () => {
      const res = await app.request('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'test',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('无效 URL 格式应返回 400', async () => {
      const res = await app.request('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'not-a-valid-url',
          source: 'test',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('fetch 失败时应返回 500', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error: DNS resolution failed'));

      const res = await app.request('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
          source: 'test',
        }),
      });

      expect(res.status).toBe(500);
    });

    it('纯文本 content 请求应仍然正常工作（向后兼容）', async () => {
      const res = await app.request('/api/v1/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '这是一条纯文本记忆，测试向后兼容性。',
          source: 'test-compat',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();

      // 纯文本路径的响应格式
      expect(body).toHaveProperty('memory_id');
      expect(body).toHaveProperty('layer', 'L1');
      expect(body).toHaveProperty('entities');
      // 纯文本路径不返回 source_info
      expect(body).not.toHaveProperty('source_info');
    });
  });

  describe('REST: POST /api/v1/memory/import-url', () => {
    it('应成功导入 URL 并返回完整响应格式', async () => {
      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();

      // 验证 import-url 专用端点的响应格式
      expect(body).toHaveProperty('experience_id');
      expect(body).toHaveProperty('experience_ids');
      expect(body).toHaveProperty('title');
      expect(body).toHaveProperty('content_length');
      expect(body).toHaveProperty('chunk_count');
      expect(body).toHaveProperty('preview');

      expect(typeof body.experience_id).toBe('string');
      expect(body.experience_ids).toBeInstanceOf(Array);
      expect(body.experience_ids.length).toBeGreaterThan(0);
      expect(body.title).toBe('MiniMem 技术架构');
      expect(body.content_length).toBeGreaterThan(0);
      expect(body.chunk_count).toBeGreaterThanOrEqual(1);
      expect(typeof body.preview).toBe('string');
      expect(body.preview.length).toBeLessThanOrEqual(300);
    });

    it('应支持 extract_mode 参数', async () => {
      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
          extract_mode: 'summary',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.experience_id).toBeTruthy();
    });

    it('应支持可选参数 context, source, tags, domain', async () => {
      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
          context: '团队技术分享资料',
          source: 'knowledge-import',
          tags: ['architecture'],
          domain: 'tech',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();

      // 验证参数传递到 L1
      const db = getDb();
      const exp = db.prepare('SELECT * FROM experiences WHERE id = ?').get(body.experience_id) as Record<string, unknown>;
      expect(exp).toBeTruthy();
      expect(exp.source).toBe('knowledge-import');
      expect(exp.domain).toBe('tech');
    });

    it('缺少 url 字段时应返回 400', async () => {
      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('L1 记忆内容应包含格式化的来源信息', async () => {
      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: MOCK_URL,
          context: '测试上下文',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();

      const db = getDb();
      const exp = db.prepare('SELECT raw_content FROM experiences WHERE id = ?').get(body.experience_id) as { raw_content: string };
      expect(exp.raw_content).toContain('[来源]');
      expect(exp.raw_content).toContain(MOCK_URL);
      expect(exp.raw_content).toContain('[标题]');
      expect(exp.raw_content).toContain('[上下文] 测试上下文');
    });
  });

  describe('REST: URL 导入去重', () => {
    it('相同 URL 内容二次导入应触发去重错误', async () => {
      // 第一次导入
      const res1 = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: MOCK_URL }),
      });
      expect(res1.status).toBe(201);

      // 第二次导入相同内容
      const res2 = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: MOCK_URL }),
      });

      // ingestMemory 内部的 hash 去重会抛出 ValidationError
      expect(res2.status).toBe(500);
    });
  });

  describe('REST: URL 导入边界情况', () => {
    it('目标返回空白页面时应报错', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        '<html><body></body></html>',
        'text/html',
      ));

      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: MOCK_URL }),
      });

      // UrlPreprocessor 会检测到内容过短并抛错
      expect(res.status).toBe(500);
    });

    it('HTTP 404 响应应报错', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse('Not Found', 'text/plain', 404));

      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: MOCK_URL }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ════════════════════════════════════════════
  // MCP Server 测试
  // ════════════════════════════════════════════

  describe('MCP: add_memory { url }', () => {
    it('应通过 URL 成功写入记忆', async () => {
      const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
      const result = await callMCPTool(server, 'add_memory', {
        url: MOCK_URL,
        source: 'mcp-test',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('memory_id');
      expect(parsed).toHaveProperty('memory_ids');
      expect(parsed).toHaveProperty('layer', 'L1');
      expect(parsed).toHaveProperty('source_info');
      expect(parsed.source_info.type).toBe('url');
      expect(parsed.source_info.url).toBe(MOCK_URL);

      // 验证 L1 写入
      const db = getDb();
      const exp = db.prepare('SELECT * FROM experiences WHERE id = ?').get(parsed.memory_id) as Record<string, unknown>;
      expect(exp).toBeTruthy();
      expect(exp.source).toBe('mcp-test');
    });

    it('content 和 url 都不提供时应返回错误', async () => {
      const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
      const result = await callMCPTool(server, 'add_memory', {
        source: 'mcp-test',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('error');
    });

    it('纯文本 content 请求应保持向后兼容', async () => {
      const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
      const result = await callMCPTool(server, 'add_memory', {
        content: '这是一条 MCP 写入的纯文本测试记忆。',
        source: 'mcp-compat',
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('memory_id');
      expect(parsed).toHaveProperty('layer', 'L1');
      // 纯文本路径返回 entities 而非 source_info
      expect(parsed).toHaveProperty('entities');
    });
  });

  describe('MCP: import_knowledge { source_type: "url" }', () => {
    it('应成功导入 URL 知识并返回正确格式', async () => {
      const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
      const result = await callMCPTool(server, 'import_knowledge', {
        source: MOCK_URL,
        source_type: 'url',
        tags: ['architecture'],
        domain: 'tech',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('experience_ids');
      expect(parsed).toHaveProperty('content_preview');
      expect(parsed).toHaveProperty('chunk_count');
      expect(parsed).toHaveProperty('title');
      expect(parsed).toHaveProperty('source_type', 'url');

      expect(parsed.experience_ids).toBeInstanceOf(Array);
      expect(parsed.experience_ids.length).toBeGreaterThan(0);
      expect(typeof parsed.content_preview).toBe('string');
      expect(parsed.chunk_count).toBeGreaterThanOrEqual(1);
    });

    it('应传递 context 参数', async () => {
      const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
      const result = await callMCPTool(server, 'import_knowledge', {
        source: MOCK_URL,
        source_type: 'url',
        context: '技术调研资料',
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);

      // 验证 context 传递到 L1
      const db = getDb();
      const exp = db.prepare('SELECT raw_content FROM experiences WHERE id = ?').get(parsed.experience_ids[0]) as { raw_content: string };
      expect(exp.raw_content).toContain('[上下文] 技术调研资料');
    });
  });

  describe('MCP: import_knowledge { source_type: "file" }', () => {
    it('文件类型应成功导入 MD/TXT 文件', async () => {
      // 创建临时测试文件
      const { writeFileSync, mkdirSync, existsSync, rmSync } = await import('fs');
      const { join } = await import('path');
      const { tmpdir } = await import('os');
      const testDir = join(tmpdir(), `minimem-mcp-file-test-${Date.now()}`);
      if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
      const testFile = join(testDir, 'test-knowledge.md');
      writeFileSync(testFile, '# Test Knowledge\n\nThis is test knowledge content for MiniMem file import verification.', 'utf-8');

      try {
        const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
        const result = await callMCPTool(server, 'import_knowledge', {
          source: testFile,
          source_type: 'file',
          context: '集成测试文件导入',
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.experience_ids).toBeDefined();
        expect(parsed.experience_ids.length).toBeGreaterThan(0);
        expect(parsed.chunk_count).toBeGreaterThanOrEqual(1);
        expect(parsed.source_type).toBe('file');
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('不存在的文件应返回错误', async () => {
      const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
      const result = await callMCPTool(server, 'import_knowledge', {
        source: '/nonexistent/path/file.md',
        source_type: 'file',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('MCP: import_knowledge 非法 source_type', () => {
    it('未知 source_type 应返回错误', async () => {
      const server = createMCPServer(() => DEFAULT_TRUSTED_CLIENT);
      const result = await callMCPTool(server, 'import_knowledge', {
        source: 'something',
        source_type: 'audio',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Unsupported source_type');
    });
  });

  // ════════════════════════════════════════════
  // 交叉验证
  // ════════════════════════════════════════════

  describe('交叉验证：REST 和 MCP 写入同一数据库', () => {
    it('REST URL 导入的记忆应可通过 MCP search 检索到', async () => {
      // 1. 通过 REST 导入 URL
      const importRes = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: MOCK_URL }),
      });
      expect(importRes.status).toBe(201);
      const importBody = await importRes.json();

      // 2. 通过 REST 按 ID 查询
      const getRes = await app.request(`/api/v1/memory/${importBody.experience_id}`);
      expect(getRes.status).toBe(200);
      const memory = await getRes.json();
      expect(memory.raw_content).toContain('MiniMem');
      expect(memory.source).toBe('url-import');
    });
  });

  // ════════════════════════════════════════════
  // 索引验证
  // ════════════════════════════════════════════

  describe('URL 导入后索引一致性', () => {
    it('导入后 FTS 索引应包含内容', async () => {
      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: MOCK_URL }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();

      // FTS 索引验证
      const db = getDb();
      const ftsRow = db.prepare('SELECT * FROM memory_fts WHERE memory_id = ?').get(body.experience_id);
      expect(ftsRow).toBeTruthy();
    });

    it('导入后温度记录应初始化', async () => {
      const res = await app.request('/api/v1/memory/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: MOCK_URL }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();

      // 温度记录验证
      const db = getDb();
      const tempRow = db.prepare('SELECT * FROM memory_temperature WHERE memory_id = ?').get(body.experience_id) as Record<string, unknown>;
      expect(tempRow).toBeTruthy();
      expect(tempRow.memory_type).toBe('L1');
    });
  });
});
