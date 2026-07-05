import { describe, it, expect } from 'vitest';
import { buildOpenApiDocument } from './openapi';

describe('openapi', () => {
  const doc = buildOpenApiDocument();

  it('génère un document OpenAPI 3.0 valide avec les chemins clés', () => {
    expect(doc.openapi).toBe('3.0.0');
    expect(doc.info.title).toBe('ReView API');
    expect(doc.paths?.['/health']).toBeTruthy();
    expect(doc.paths?.['/api/projects']?.get).toBeTruthy();
    expect(doc.paths?.['/api/projects']?.post).toBeTruthy();
    expect(doc.paths?.['/api/auth/login']?.post).toBeTruthy();
  });

  it('expose les schémas partagés et le sécurité bearer', () => {
    expect(doc.components?.schemas?.Project).toBeTruthy();
    expect(doc.components?.schemas?.ProjectPage).toBeTruthy();
    expect(doc.components?.securitySchemes?.bearerAuth).toBeTruthy();
  });

  it('documente la pagination sur GET /api/projects (query page/pageSize)', () => {
    const params = doc.paths?.['/api/projects']?.get?.parameters ?? [];
    const names = params.map((p) => (p as { name?: string }).name);
    expect(names).toContain('page');
    expect(names).toContain('pageSize');
  });
});
