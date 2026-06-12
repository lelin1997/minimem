// ============================================================
// MiniMem — URL 安全校验（SSRF 防护）
// ============================================================
// 职责：防止通过 URL 导入功能触发 SSRF 攻击
// 多层防护：协议白名单 → 域名黑名单 → 端口白名单 → IP 检测 → DNS 解析后二次检查

import { getLogger } from '../../common/logger.js';
import { lookup } from 'node:dns/promises';

const log = getLogger('core:url-security');

// ── 允许的协议 ──
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// ── 允许的端口（空端口 = 默认端口，也允许） ──
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443', '3000', '5000', '8000', '8888']);

// ── 默认域名黑名单 ──
const DEFAULT_BLOCKED_DOMAINS = new Set([
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata service
  'metadata.tencentyun.com', // 腾讯云 metadata
  'instance-data',
]);

export interface UrlSecurityConfig {
  /** 额外的域名黑名单 */
  blocked_domains?: string[];
  /** 是否启用 DNS 解析后检查（防 DNS rebinding） */
  dns_resolve_check?: boolean;
  /** 额外允许的端口 */
  allowed_ports?: number[];
}

export interface UrlValidationResult {
  valid: boolean;
  url?: URL;
  error?: string;
}

/**
 * 校验 URL 是否安全可访问
 *
 * 防护层级：
 * 1. URL 格式合法性
 * 2. 协议白名单（仅 http/https）
 * 3. 域名黑名单
 * 4. 端口白名单
 * 5. 主机名内网 IP 检测
 * 6. DNS 解析后二次 IP 检测（防 DNS rebinding）
 */
export async function validateUrl(
  rawUrl: string,
  config?: UrlSecurityConfig,
): Promise<UrlValidationResult> {
  // 1. URL 格式合法性
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { valid: false, error: `Invalid URL format: ${rawUrl}` };
  }

  // 2. 协议白名单
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { valid: false, error: `Protocol not allowed: ${url.protocol} (only http/https)` };
  }

  // 3. 域名黑名单
  const blockedDomains = new Set([
    ...DEFAULT_BLOCKED_DOMAINS,
    ...(config?.blocked_domains ?? []),
  ]);
  if (blockedDomains.has(url.hostname)) {
    return { valid: false, error: `Blocked domain: ${url.hostname}` };
  }

  // 4. 端口白名单
  const allowedPorts = new Set([
    ...ALLOWED_PORTS,
    ...(config?.allowed_ports?.map(String) ?? []),
  ]);
  if (url.port && !allowedPorts.has(url.port)) {
    return { valid: false, error: `Port not allowed: ${url.port}` };
  }

  // 5. 主机名直接 IP 检测
  if (isPrivateIP(url.hostname)) {
    return { valid: false, error: `Private/internal IP detected: ${url.hostname}` };
  }

  // 6. DNS 解析后二次检查（防 DNS rebinding）
  if (config?.dns_resolve_check !== false) {
    try {
      const resolved = await lookup(url.hostname);
      if (isPrivateIP(resolved.address)) {
        log.warn({
          hostname: url.hostname,
          resolvedIP: resolved.address,
        }, 'DNS rebinding detected: hostname resolves to private IP');
        return { valid: false, error: `DNS rebinding detected: ${url.hostname} resolves to private IP ${resolved.address}` };
      }
    } catch (err) {
      // DNS 解析失败 — 可能是不存在的域名
      log.debug({ hostname: url.hostname, err }, 'DNS resolution failed');
      return { valid: false, error: `DNS resolution failed for: ${url.hostname}` };
    }
  }

  return { valid: true, url };
}

/**
 * 检测是否为内网/私有 IP 地址
 *
 * 覆盖范围：
 * - 127.0.0.0/8 (loopback)
 * - 10.0.0.0/8 (RFC 1918)
 * - 172.16.0.0/12 (RFC 1918)
 * - 192.168.0.0/16 (RFC 1918)
 * - 169.254.0.0/16 (link-local)
 * - 0.0.0.0
 * - ::1, :: (IPv6 loopback / unspecified)
 * - fc00::/7 (IPv6 ULA)
 * - fe80::/10 (IPv6 link-local)
 */
export function isPrivateIP(ip: string): boolean {
  // IPv6 处理
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // IPv6 ULA (fc00::/7) 和 link-local (fe80::/10)
  const lowerIp = ip.toLowerCase();
  if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd') || lowerIp.startsWith('fe80')) {
    return true;
  }

  // IPv4 处理
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) {
    // 不是标准 IPv4，如果也不是 IPv6 则认为不是私有 IP
    return false;
  }

  const [a, b] = parts;

  // 0.0.0.0
  if (a === 0) return true;

  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;

  // 10.0.0.0/8
  if (a === 10) return true;

  // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;

  return false;
}
