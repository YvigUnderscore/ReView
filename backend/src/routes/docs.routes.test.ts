// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { setting: { findUnique: vi.fn() } },
}));

import express from 'express';
import request from 'supertest';
import docsRoutes from './docs.routes';
import { prisma } from '../lib/prisma';

const findUnique = vi.mocked(prisma.setting.findUnique);
const app = express().use('/api', docsRoutes);

beforeEach(() => vi.clearAllMocks());

/**
 * `/api/docs` est servi sans authentification : c'est une surface réseau au sens de
 * l'AGPL §13, au même titre que la page de connexion. Elle doit donc porter la mention
 * légale et l'offre du code source correspondant.
 */
describe('GET /api/docs — surface publique', () => {
  it('porte copyright, licence, absence de garantie et lien source', async () => {
    findUnique.mockResolvedValue({ value: 'https://git.studio.tld/review' } as never);
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Copyright © 2026 Yvig Bidon');
    expect(res.text).toContain('AGPL-3.0-or-later');
    expect(res.text).toContain('sans aucune garantie');
    expect(res.text).toContain('href="https://git.studio.tld/review"');
  });

  it('retombe sur le dépôt amont quand le réglage studio est vide', async () => {
    findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/docs');
    expect(res.text).toContain('href="https://github.com/YvigUnderscore/ReView"');
  });

  it('n’injecte pas une URL de réglage hostile dans l’attribut href', async () => {
    findUnique.mockResolvedValue({ value: 'javascript:alert(1)' } as never);
    const res = await request(app).get('/api/docs');
    expect(res.text).not.toContain('javascript:');
    expect(res.text).toContain('href="https://github.com/YvigUnderscore/ReView"');
  });

  it('épingle Scalar sur une version exacte et vérifie son empreinte', async () => {
    findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/docs');
    const tag = /<script src="([^"]+)" integrity="([^"]+)" crossorigin="anonymous"><\/script>/.exec(res.text);
    expect(tag).not.toBeNull();
    const [, src, integrity] = tag!;
    // `@latest` implicite = le code de demain, sans revue : la version doit être dans l'URL.
    expect(src).toMatch(/@scalar\/api-reference@\d+\.\d+\.\d+\//);
    expect(src).not.toMatch(/@scalar\/api-reference(["/]|@latest)/);
    expect(integrity).toMatch(/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/);
  });

  it('n’autorise plus le script inline et borne la source au paquet épinglé', async () => {
    findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/docs');
    const header = String(res.headers['content-security-policy']);
    const directives = Object.fromEntries(
      header
        .split(';')
        .map((d) => d.trim())
        .map((d) => [d.split(' ')[0], d]),
    ) as Record<string, string>;

    expect(directives['script-src']).not.toContain("'unsafe-inline'");
    expect(directives['script-src']).toContain('/npm/@scalar/api-reference@');
    // Le CDN entier n'est plus une source de script : seule cette version l'est.
    expect(directives['script-src']).not.toMatch(/cdn\.jsdelivr\.net\s*($|;)/);
    // Plus de « n'importe quel https » (le schéma nu, sans hôte) pour les polices ni les images.
    expect(directives['font-src']).not.toMatch(/\shttps:(\s|$)/);
    expect(directives['img-src']).not.toMatch(/\shttps:(\s|$)/);
    expect(directives['connect-src']).toBe("connect-src 'self'");
    expect(directives['object-src']).toBe("object-src 'none'");
    expect(directives['frame-ancestors']).toBe("frame-ancestors 'none'");
  });

  it('tire un nonce par réponse, et c’est celui de la balise inline', async () => {
    findUnique.mockResolvedValue(null);
    const first = await request(app).get('/api/docs');
    const second = await request(app).get('/api/docs');
    const nonceOf = (res: { headers: Record<string, unknown> }) =>
      /'nonce-([^']+)'/.exec(String(res.headers['content-security-policy']))?.[1] ?? '';

    expect(first.text).toContain(`<script nonce="${nonceOf(first)}" id="api-reference"`);
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it('déclare la licence dans le document OpenAPI, lui aussi public', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.info.license).toEqual({
      name: 'AGPL-3.0-or-later',
      url: 'https://www.gnu.org/licenses/agpl-3.0.html',
    });
  });
});
