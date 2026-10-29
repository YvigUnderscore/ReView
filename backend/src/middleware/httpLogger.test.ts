// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { redactUrl } from './httpLogger';

/**
 * Logs are kept for a long time and read by more people than the database: a token that lands in
 * them in plain text is a public token. These cases fix the boundary between what must disappear
 * (the secret) and what must remain (the path, the identifier, the filter): a fully masked log is
 * no longer useful for diagnosis.
 */
describe('redactUrl — tokens carried by the path', () => {
  it("masks the invitation token, which sets a password and opens a session", () => {
    expect(redactUrl('/api/auth/invitation/abc123def456')).toBe('/api/auth/invitation/[Redacted]');
  });

  it('masks the client share token without losing the rest of the path', () => {
    expect(redactUrl('/api/client/s3cr3t/media/42/url')).toBe('/api/client/[Redacted]/media/42/url');
  });

  it('masks the unsubscribe token', () => {
    expect(redactUrl('/api/unsubscribe/7.emailDigest.SIGNATURE')).toBe('/api/unsubscribe/[Redacted]');
  });

  it('masks the ShotGrid webhook token (historical case, not regressed)', () => {
    expect(redactUrl('/api/shotgrid/webhook/wh-token')).toBe('/api/shotgrid/webhook/[Redacted]');
  });

  it('masks both path AND query in the same URL', () => {
    expect(redactUrl('/api/client/s3cr3t?token=jwt.value&projectId=4')).toBe(
      '/api/client/[Redacted]?token=[Redacted]&projectId=4',
    );
  });

  it("anchors the pattern only at the start of the URL (no masking on a path that imitates it)", () => {
    expect(redactUrl('/api/media/1/api/client/x')).toBe('/api/media/1/api/client/x');
  });

  it("leaves the numeric identifier of a share link intact", () => {
    expect(redactUrl('/api/share/42')).toBe('/api/share/42');
  });
});

describe('redactUrl — secrets carried by the query', () => {
  it('masks ?token= (/metrics token, Socket.io fallback transport)', () => {
    expect(redactUrl('/metrics?token=abc')).toBe('/metrics?token=[Redacted]');
  });

  it('masks an unknown but telling parameter name', () => {
    expect(redactUrl('/x?shareAuth=a&access_token=b&apiKey=c&refreshToken=d')).toBe(
      '/x?shareAuth=[Redacted]&access_token=[Redacted]&apiKey=[Redacted]&refreshToken=[Redacted]',
    );
  });

  it("masks the code and state of the OIDC callback", () => {
    expect(redactUrl('/api/auth/oidc/callback?code=xyz&state=st')).toBe(
      '/api/auth/oidc/callback?code=[Redacted]&state=[Redacted]',
    );
  });

  it('keeps the filter parameters, which are the whole point of the log', () => {
    expect(redactUrl('/api/media?projectId=4&limit=50&q=plan')).toBe(
      '/api/media?projectId=4&limit=50&q=plan',
    );
  });

  it('masks several occurrences of the same parameter', () => {
    expect(redactUrl('/x?token=a&token=b')).toBe('/x?token=[Redacted]&token=[Redacted]');
  });

  it('handles a degenerate query without crashing', () => {
    expect(redactUrl('/x?')).toBe('/x?');
    expect(redactUrl('/x?flag')).toBe('/x?flag');
    expect(redactUrl('/x?to%ZZken=a')).toBe('/x?to%ZZken=a');
  });
});
