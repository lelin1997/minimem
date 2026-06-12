/**
 * 自定义节点类型 — 后端路由
 * 用户可以上传 JS executor 代码，创建自定义节点
 */

import { Hono } from 'hono';
import { getDb } from '../db.js';
import { randomUUID } from 'crypto';
import { registerExecutor, hasExecutor, getExecutor } from '../executors/index.js';
import { type RunContext } from '../engine/context.js';

export const customNodeRoutes = new Hono();

/**
 * 自定义节点在数据库中的存储
 */
function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_node_types (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'custom',
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'puzzle',
      color TEXT NOT NULL DEFAULT '#6B7280',
      inputs TEXT NOT NULL DEFAULT '[]',
      outputs TEXT NOT NULL DEFAULT '[]',
      config_schema TEXT NOT NULL DEFAULT '{}',
      executor_code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

ensureTable();

// 启动时注册所有自定义节点
function initCustomNodes() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM custom_node_types').all() as any[];
  for (const row of rows) {
    try {
      registerCustomExecutor(row.type, row.executor_code);
    } catch (err: any) {
      console.error(`[CustomNode] 注册自定义节点 ${row.type} 失败:`, err.message);
    }
  }
  if (rows.length > 0) {
    console.log(`[CustomNode] 加载了 ${rows.length} 个自定义节点类型`);
  }
}

initCustomNodes();

/**
 * 注册自定义执行器
 * 用户代码格式：
 *   module.exports = async function(node, inputs, ctx) { return { outputs: { out: ... } }; }
 * 或：
 *   (node, inputs, ctx) => { ... }
 */
function registerCustomExecutor(type: string, code: string) {
  // 创建沙箱化的执行函数
  const executor = async (
    node: any,
    inputs: Record<string, unknown>,
    ctx: RunContext,
    templateData: Record<string, unknown>,
  ) => {
    // 构造安全的上下文
    const safeCtx = {
      runId: ctx.runId,
      pipelineId: ctx.pipelineId,
      variables: ctx.variables,
    };

    try {
      // 使用 Function 构造器创建沙箱
      const fn = new Function(
        'node', 'inputs', 'ctx', 'config',
        `
        const module = { exports: null };
        ${code}
        ;
        if (typeof module.exports === 'function') {
          return module.exports(node, inputs, ctx);
        }
        throw new Error('自定义节点代码必须导出一个函数 (module.exports = async function(...) { ... })');
        `
      );

      const result = await fn(node, inputs, safeCtx, node.config || {});

      // 规范化输出
      if (result && typeof result === 'object' && result.outputs) {
        return result;
      }
      // 如果直接返回数据，包装为 { outputs: { out: data } }
      return { outputs: { out: result } };
    } catch (err: any) {
      throw new Error(`自定义节点执行错误: ${err.message}`);
    }
  };

  registerExecutor(type, executor);
}

// ── 路由 ──

// 列出所有自定义节点类型
customNodeRoutes.get('/', (c) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM custom_node_types ORDER BY created_at DESC').all() as any[];

  const nodeTypes = rows.map((r) => ({
    ...r,
    inputs: JSON.parse(r.inputs || '[]'),
    outputs: JSON.parse(r.outputs || '[]'),
    config_schema: JSON.parse(r.config_schema || '{}'),
  }));

  return c.json({ customNodeTypes: nodeTypes });
});

// 获取单个
customNodeRoutes.get('/:type', (c) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM custom_node_types WHERE type = ?').get(c.req.param('type')) as any;
  if (!row) return c.json({ error: '自定义节点不存在' }, 404);

  return c.json({
    ...row,
    inputs: JSON.parse(row.inputs || '[]'),
    outputs: JSON.parse(row.outputs || '[]'),
    config_schema: JSON.parse(row.config_schema || '{}'),
  });
});

// 创建自定义节点
customNodeRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { type, label, description, icon, color, inputs, outputs, configSchema, executorCode } = body;

  if (!type || !label || !executorCode) {
    return c.json({ error: '缺少必填字段: type, label, executorCode' }, 400);
  }

  // 检查类型名冲突
  if (hasExecutor(type)) {
    return c.json({ error: `节点类型 "${type}" 已存在（内置或已注册）` }, 409);
  }

  // 验证代码可执行
  try {
    registerCustomExecutor(type, executorCode);
  } catch (err: any) {
    return c.json({ error: `代码注册失败: ${err.message}` }, 400);
  }

  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO custom_node_types (id, type, label, description, icon, color, inputs, outputs, config_schema, executor_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    type,
    label,
    description || '',
    icon || 'puzzle',
    color || '#6B7280',
    JSON.stringify(inputs || [{ id: 'in', label: '输入', type: 'any' }]),
    JSON.stringify(outputs || [{ id: 'out', label: '输出', type: 'any' }]),
    JSON.stringify(configSchema || {}),
    executorCode,
  );

  return c.json({ id, type, label, message: '自定义节点创建成功' }, 201);
});

// 更新自定义节点
customNodeRoutes.put('/:type', async (c) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM custom_node_types WHERE type = ?').get(c.req.param('type')) as any;
  if (!existing) return c.json({ error: '自定义节点不存在' }, 404);

  const body = await c.req.json();
  const { label, description, icon, color, inputs, outputs, configSchema, executorCode } = body;

  // 如果更新了代码，重新注册
  if (executorCode && executorCode !== existing.executor_code) {
    try {
      registerCustomExecutor(existing.type, executorCode);
    } catch (err: any) {
      return c.json({ error: `代码更新失败: ${err.message}` }, 400);
    }
  }

  db.prepare(`
    UPDATE custom_node_types SET
      label = COALESCE(?, label),
      description = COALESCE(?, description),
      icon = COALESCE(?, icon),
      color = COALESCE(?, color),
      inputs = COALESCE(?, inputs),
      outputs = COALESCE(?, outputs),
      config_schema = COALESCE(?, config_schema),
      executor_code = COALESCE(?, executor_code),
      updated_at = datetime('now')
    WHERE type = ?
  `).run(
    label || null,
    description || null,
    icon || null,
    color || null,
    inputs ? JSON.stringify(inputs) : null,
    outputs ? JSON.stringify(outputs) : null,
    configSchema ? JSON.stringify(configSchema) : null,
    executorCode || null,
    c.req.param('type'),
  );

  return c.json({ type: existing.type, message: '自定义节点已更新' });
});

// 删除自定义节点
customNodeRoutes.delete('/:type', (c) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_node_types WHERE type = ?').run(c.req.param('type'));
  if (result.changes === 0) return c.json({ error: '自定义节点不存在' }, 404);
  return c.json({ success: true });
});
