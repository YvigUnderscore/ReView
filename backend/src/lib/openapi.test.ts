// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildOpenApiDocument } from './openapi';

describe('openapi', () => {
  const doc = buildOpenApiDocument();

  it('generates a valid OpenAPI 3.0 document with the key paths', () => {
    expect(doc.openapi).toBe('3.0.0');
    expect(doc.info.title).toBe('ReView API');
    expect(doc.paths?.['/health']).toBeTruthy();
    expect(doc.paths?.['/api/projects']?.get).toBeTruthy();
    expect(doc.paths?.['/api/projects']?.post).toBeTruthy();
    expect(doc.paths?.['/api/auth/login']?.post).toBeTruthy();
  });

  it('declares the project licence — the document is served publicly', () => {
    expect(doc.info.license?.name).toBe('AGPL-3.0-or-later');
    expect(doc.info.license?.url).toContain('gnu.org');
  });

  it('exposes the shared schemas and the bearer security', () => {
    expect(doc.components?.schemas?.Project).toBeTruthy();
    expect(doc.components?.schemas?.ProjectPage).toBeTruthy();
    expect(doc.components?.securitySchemes?.bearerAuth).toBeTruthy();
  });

  it('documents the "usd" field of POST /api/v1/publish — otherwise an integrator cannot guess it', () => {
    const schema = doc.paths?.['/api/v1/publish']?.post?.requestBody as
      | { content?: Record<string, { schema?: { properties?: Record<string, { description?: string }> } }> }
      | undefined;
    const usd = schema?.content?.['application/json']?.schema?.properties?.usd;
    expect(usd).toBeTruthy();
    expect(usd?.description).toMatch(/première conversion/i);
  });

  it('documents the pagination on GET /api/projects (query page/pageSize)', () => {
    const params = doc.paths?.['/api/projects']?.get?.parameters ?? [];
    const names = params.map((p) => (p as { name?: string }).name);
    expect(names).toContain('page');
    expect(names).toContain('pageSize');
  });
});
