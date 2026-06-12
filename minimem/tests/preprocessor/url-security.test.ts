// ============================================================
// MiniMem — URL Security 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { isPrivateIP, validateUrl } from '../../src/core/preprocessor/url-security.js';

describe('isPrivateIP', () => {
  // ── 内网 IP ──
  it.each([
    ['127.0.0.1', true],
    ['127.0.0.2', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.0.1', true],
    ['192.168.1.100', true],
    ['169.254.1.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['::', true],
    ['0:0:0:0:0:0:0:1', true],
    ['fc00::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
  ])('should detect %s as private IP → %s', (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });

  // ── 公网 IP ──
  it.each([
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['104.16.132.229', false],
    ['172.32.0.1', false],  // 不在 172.16-31 范围内
    ['172.15.0.1', false],
    ['192.169.0.1', false],
    ['11.0.0.1', false],
  ])('should detect %s as public IP → %s', (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });
});

describe('validateUrl', () => {
  it('should reject invalid URL format', async () => {
    const result = await validateUrl('not-a-url', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('should reject non-http protocols', async () => {
    const result = await validateUrl('ftp://example.com/file', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Protocol not allowed');
  });

  it('should reject javascript protocol', async () => {
    const result = await validateUrl('javascript:alert(1)', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Protocol not allowed');
  });

  it('should reject file protocol', async () => {
    const result = await validateUrl('file:///etc/passwd', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Protocol not allowed');
  });

  it('should reject blocked domains', async () => {
    const result = await validateUrl('http://169.254.169.254/latest/meta-data/', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Blocked domain');
  });

  it('should reject custom blocked domains', async () => {
    const result = await validateUrl('http://evil.com/data', {
      blocked_domains: ['evil.com'],
      dns_resolve_check: false,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Blocked domain');
  });

  it('should reject private IP in URL', async () => {
    const result = await validateUrl('http://127.0.0.1:8080/admin', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Private/internal IP');
  });

  it('should reject internal network IPs', async () => {
    const result = await validateUrl('http://10.0.0.1/internal', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Private/internal IP');
  });

  it('should reject disallowed ports', async () => {
    const result = await validateUrl('http://example.com:22/ssh', { dns_resolve_check: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Port not allowed');
  });

  it('should allow valid public URLs (without DNS check)', async () => {
    const result = await validateUrl('https://example.com/page', { dns_resolve_check: false });
    expect(result.valid).toBe(true);
    expect(result.url).toBeDefined();
    expect(result.url!.hostname).toBe('example.com');
  });

  it('should allow default ports (80, 443)', async () => {
    const result80 = await validateUrl('http://example.com:80/page', { dns_resolve_check: false });
    const result443 = await validateUrl('https://example.com:443/page', { dns_resolve_check: false });
    expect(result80.valid).toBe(true);
    expect(result443.valid).toBe(true);
  });

  it('should allow custom ports', async () => {
    const result = await validateUrl('http://example.com:9090/api', {
      dns_resolve_check: false,
      allowed_ports: [9090],
    });
    expect(result.valid).toBe(true);
  });
});
