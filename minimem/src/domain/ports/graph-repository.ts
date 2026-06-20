// ============================================================
// MiniMem — Graph Repository Port (P3.1 依赖倒置)
// ============================================================
// 记忆图谱访问端口，domain 层通过此接口操作记忆间的连接关系。
// infra/store/graph.ts 在 app 启动时通过 registerGraphRepository 注册实现。

import type { MemoryLink, MemoryLayer, LinkType } from '../../common/types.js';

export interface GraphRepository {
  createLink(
    sourceId: string,
    sourceType: MemoryLayer,
    targetId: string,
    targetType: MemoryLayer,
    linkType: LinkType,
    weight?: number,
  ): MemoryLink;
  getOutboundLinks(sourceId: string): MemoryLink[];
  getInboundLinks(targetId: string): MemoryLink[];
  traverseGraph(startId: string, maxHops?: number, maxResults?: number): MemoryLink[];
  deleteNodeLinks(nodeId: string): number;
}

// ── Registry ──

let _factory: (() => GraphRepository) | null = null;

export function registerGraphRepository(factory: () => GraphRepository): void {
  _factory = factory;
}

export function getGraphRepository(): GraphRepository {
  if (!_factory) {
    throw new Error('GraphRepository factory not registered. Call registerGraphRepository() at app startup.');
  }
  return _factory();
}

// ── 便捷函数: 保持 domain 代码的函数式调用风格 ──

export function createLink(
  sourceId: string,
  sourceType: MemoryLayer,
  targetId: string,
  targetType: MemoryLayer,
  linkType: LinkType,
  weight?: number,
): MemoryLink {
  return getGraphRepository().createLink(sourceId, sourceType, targetId, targetType, linkType, weight);
}

export function getOutboundLinks(sourceId: string): MemoryLink[] {
  return getGraphRepository().getOutboundLinks(sourceId);
}

export function getInboundLinks(targetId: string): MemoryLink[] {
  return getGraphRepository().getInboundLinks(targetId);
}

export function traverseGraph(startId: string, maxHops?: number, maxResults?: number): MemoryLink[] {
  return getGraphRepository().traverseGraph(startId, maxHops, maxResults);
}

export function deleteNodeLinks(nodeId: string): number {
  return getGraphRepository().deleteNodeLinks(nodeId);
}
