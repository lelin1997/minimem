// ============================================================
// MiniMem — Webhook Connector (TODO-022.2)
// ============================================================
// 接收 HTTP POST webhook 回调，将数据写入 MiniMem 记忆

import { getLogger } from '../common/logger.js';
import type { Connector, ConnectorInfo, ConnectorStatus, EventHandler, ConnectorEvent } from './base.js';

const log = getLogger('connectors:webhook');

/**
 * Webhook 连接器配置
 */
export interface WebhookConnectorConfig {
  /** 连接器名称 */
  name: string;
  /** 监听端口（独立于 MiniMem REST API） */
  port: number;
  /** 监听路径 */
  path: string;
  /** 可选的认证 token（校验 X-Webhook-Token 头） */
  secret?: string;
  /** 可选的来源标签（标识 webhook 来源） */
  sourceTag?: string;
}

const DEFAULT_WEBHOOK_CONFIG: WebhookConnectorConfig = {
  name: 'webhook',
  port: 6679,
  path: '/webhook',
  sourceTag: 'webhook',
};

/**
 * Webhook 连接器
 *
 * 启动一个轻量 HTTP 服务器，接收 POST 请求，
 * 解析 body 为 ConnectorEvent 后调用注册的 handler。
 *
 * 请求 body 格式：
 * ```json
 * {
 *   "type": "event_type",
 *   "content": "事件内容文本",
 *   "metadata": { ... }
 * }
 * ```
 */
export class WebhookConnector implements Connector {
  readonly name: string;
  readonly type = 'webhook';
  private _status: ConnectorStatus = 'idle';
  private config: WebhookConnectorConfig;
  private handlers: EventHandler[] = [];
  private server: ReturnType<typeof import('http')['createServer']> | null = null;
  private _eventsReceived = 0;
  private _eventsProcessed = 0;
  private _lastEventAt: string | null = null;

  constructor(config?: Partial<WebhookConnectorConfig>) {
    this.config = { ...DEFAULT_WEBHOOK_CONFIG, ...config };
    this.name = this.config.name;
  }

  get status(): ConnectorStatus {
    return this._status;
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    if (this._status === 'running') return;

    const http = await import('http');
    this.server = http.createServer(async (req, res) => {
      // 只处理 POST 到指定路径
      if (req.method !== 'POST' || req.url !== this.config.path) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      // 认证检查
      if (this.config.secret) {
        const token = req.headers['x-webhook-token'] as string;
        if (token !== this.config.secret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }

      // 读取 body
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as {
          type?: string;
          content?: string;
          metadata?: Record<string, unknown>;
        };

        if (!parsed.content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing content field' }));
          return;
        }

        const event: ConnectorEvent = {
          source: this.config.sourceTag ?? this.name,
          type: parsed.type ?? 'webhook',
          content: parsed.content,
          metadata: parsed.metadata,
          timestamp: new Date().toISOString(),
        };

        this._eventsReceived++;

        // 调用所有 handler
        for (const handler of this.handlers) {
          try {
            await handler(event);
            this._eventsProcessed++;
          } catch (err) {
            log.warn({ err, event: event.type }, 'Webhook handler error');
          }
        }

        this._lastEventAt = event.timestamp;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, event_type: event.type }));
      } catch (err) {
        log.warn({ err }, 'Webhook request processing error');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, () => {
        this._status = 'running';
        log.info(
          { port: this.config.port, path: this.config.path },
          `Webhook connector listening on :${this.config.port}${this.config.path}`,
        );
        resolve();
      });
      this.server!.on('error', (err) => {
        this._status = 'error';
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this._status = 'stopped';
        this.server = null;
        log.info({ name: this.name }, 'Webhook connector stopped');
        resolve();
      });
    });
  }

  getInfo(): ConnectorInfo {
    return {
      name: this.name,
      type: this.type,
      status: this._status,
      eventsReceived: this._eventsReceived,
      eventsProcessed: this._eventsProcessed,
      lastEventAt: this._lastEventAt,
      config: {
        port: this.config.port,
        path: this.config.path,
        hasSecret: !!this.config.secret,
      },
    };
  }
}

// ── Helper ──

function readBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
