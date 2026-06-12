// ============================================================
// MiniMem — 外部数据源连接器框架 (REQ-021 / TODO-022)
// ============================================================
// 可扩展的连接器抽象：外部数据源 → MiniMem 记忆

import { getLogger } from '../common/logger.js';

const log = getLogger('connectors');

/**
 * 连接器状态
 */
export type ConnectorStatus = 'idle' | 'running' | 'stopped' | 'error';

/**
 * 连接器接收到的外部数据
 */
export interface ConnectorEvent {
  /** 来源连接器名称 */
  source: string;
  /** 事件类型（由具体连接器定义） */
  type: string;
  /** 原始内容 */
  content: string;
  /** 可选元数据 */
  metadata?: Record<string, unknown>;
  /** 事件时间 */
  timestamp: string;
}

/**
 * 事件处理器：将连接器事件转化为 MiniMem 记忆写入
 */
export type EventHandler = (event: ConnectorEvent) => Promise<void>;

/**
 * 连接器抽象接口
 *
 * 所有外部数据源连接器必须实现此接口。
 * 连接器负责：
 * 1. 监听外部数据源（webhook、文件系统、消息队列等）
 * 2. 将接收到的数据转化为 ConnectorEvent
 * 3. 调用注册的 EventHandler 将事件写入 MiniMem
 */
export interface Connector {
  /** 连接器唯一名称 */
  readonly name: string;

  /** 连接器类型标识 */
  readonly type: string;

  /** 当前状态 */
  readonly status: ConnectorStatus;

  /** 启动连接器 */
  start(): Promise<void>;

  /** 停止连接器 */
  stop(): Promise<void>;

  /** 注册事件处理器 */
  onEvent(handler: EventHandler): void;

  /** 获取连接器信息（用于健康检查 / 监控） */
  getInfo(): ConnectorInfo;
}

/**
 * 连接器信息（用于诊断和监控）
 */
export interface ConnectorInfo {
  name: string;
  type: string;
  status: ConnectorStatus;
  eventsReceived: number;
  eventsProcessed: number;
  lastEventAt: string | null;
  config: Record<string, unknown>;
}

/**
 * 连接器配置（通用字段）
 */
export interface ConnectorConfig {
  /** 连接器是否启用 */
  enabled: boolean;
  /** 连接器名称 */
  name: string;
  /** 连接器类型 */
  type: string;
  /** 类型特定配置 */
  [key: string]: unknown;
}

// ── 连接器注册表 ──

const _connectors = new Map<string, Connector>();

/**
 * 注册连接器
 */
export function registerConnector(connector: Connector): void {
  if (_connectors.has(connector.name)) {
    log.warn({ name: connector.name }, 'Connector already registered, replacing');
  }
  _connectors.set(connector.name, connector);
  log.info({ name: connector.name, type: connector.type }, 'Connector registered');
}

/**
 * 获取已注册的连接器
 */
export function getConnector(name: string): Connector | undefined {
  return _connectors.get(name);
}

/**
 * 获取所有已注册的连接器
 */
export function getAllConnectors(): Connector[] {
  return Array.from(_connectors.values());
}

/**
 * 启动所有已注册的连接器
 */
export async function startAllConnectors(): Promise<void> {
  for (const connector of _connectors.values()) {
    try {
      await connector.start();
      log.info({ name: connector.name }, 'Connector started');
    } catch (err) {
      log.error({ err, name: connector.name }, 'Failed to start connector');
    }
  }
}

/**
 * 停止所有已注册的连接器
 */
export async function stopAllConnectors(): Promise<void> {
  for (const connector of _connectors.values()) {
    try {
      await connector.stop();
      log.info({ name: connector.name }, 'Connector stopped');
    } catch (err) {
      log.warn({ err, name: connector.name }, 'Failed to stop connector');
    }
  }
}

/**
 * 获取所有连接器信息（用于健康检查）
 */
export function getConnectorsInfo(): ConnectorInfo[] {
  return Array.from(_connectors.values()).map(c => c.getInfo());
}

/**
 * 默认事件处理器：通过 MiniMem 的 ingest pipeline 写入记忆
 */
export function createDefaultEventHandler(): EventHandler {
  return async (event: ConnectorEvent) => {
    try {
      const { ingestMemory } = await import('../core/perception.js');
      await ingestMemory({
        content: event.content,
        source: `connector:${event.source}`,
        content_type: 'note',
        tags: [`connector:${event.source}`, `event:${event.type}`],
        context: event.metadata ? JSON.stringify(event.metadata) : undefined,
      });
      log.debug({ source: event.source, type: event.type }, 'Connector event ingested');
    } catch (err) {
      log.warn({ err, source: event.source }, 'Failed to ingest connector event');
    }
  };
}
