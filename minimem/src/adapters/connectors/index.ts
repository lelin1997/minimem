// ============================================================
// MiniMem — Connectors 统一导出
// ============================================================

export type {
  Connector,
  ConnectorEvent,
  ConnectorInfo,
  ConnectorConfig,
  ConnectorStatus,
  EventHandler,
} from './base.js';

export {
  registerConnector,
  getConnector,
  getAllConnectors,
  startAllConnectors,
  stopAllConnectors,
  getConnectorsInfo,
  createDefaultEventHandler,
} from './base.js';

export { WebhookConnector } from './webhook.js';
export type { WebhookConnectorConfig } from './webhook.js';

export { FileWatcherConnector } from './file-watcher.js';
export type { FileWatcherConnectorConfig } from './file-watcher.js';
