import { describe, it, expect } from 'vitest';
import { isWebhookUrlAllowed, signWebhookPayload } from './webhooks';

describe('isWebhookUrlAllowed', () => {
  it('accepte les URLs http(s) publiques', () => {
    expect(isWebhookUrlAllowed('https://hooks.slack.com/services/abc')).toBe(true);
    expect(isWebhookUrlAllowed('http://example.com/hook')).toBe(true);
  });

  it('refuse loopback et réseaux privés (SSRF)', () => {
    for (const url of [
      'http://localhost:3000/hook',
      'http://127.0.0.1/x',
      'http://10.0.0.5/x',
      'http://192.168.1.10/x',
      'http://172.16.0.1/x',
      'http://172.31.255.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/x',
      'http://[::1]/x',
      'http://minio.local/x',
      'http://backend/x',
    ]) {
      expect(isWebhookUrlAllowed(url), url).toBe(false);
    }
  });

  it('refuse les schémas non http et les URLs invalides', () => {
    expect(isWebhookUrlAllowed('ftp://example.com/x')).toBe(false);
    expect(isWebhookUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isWebhookUrlAllowed('pas une url')).toBe(false);
  });

  it('laisse passer 172.32.x (hors plage privée)', () => {
    expect(isWebhookUrlAllowed('http://172.32.0.1/x')).toBe(true);
  });
});

describe('signWebhookPayload', () => {
  it('signature stable et liée au timestamp', () => {
    const a = signWebhookPayload('secret', '1000', '{"a":1}');
    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhookPayload('secret', '1000', '{"a":1}')).toBe(a);
    expect(signWebhookPayload('secret', '1001', '{"a":1}')).not.toBe(a);
    expect(signWebhookPayload('autre', '1000', '{"a":1}')).not.toBe(a);
  });
});
