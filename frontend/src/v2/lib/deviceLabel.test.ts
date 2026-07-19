import { describe, it, expect } from 'vitest';
import { deviceLabel } from './deviceLabel';

describe('deviceLabel', () => {
  it('reconnaît Chrome/Windows', () => {
    expect(
      deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'),
    ).toBe('Chrome · Windows');
  });
  it('Edge prime sur Chrome (l’UA Edge contient chrome/)', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0')).toBe(
      'Edge · Windows',
    );
  });
  it('Safari macOS et iOS', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1')).toBe(
      'Safari · macOS',
    );
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/604.1')).toBe(
      'Safari · iOS',
    );
  });
  it('repli sur inconnu', () => {
    expect(deviceLabel(null)).toBe('Appareil inconnu');
    expect(deviceLabel('curl/8.0')).toBe('Navigateur');
  });
});
