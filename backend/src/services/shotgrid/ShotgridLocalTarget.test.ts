// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { links } = vi.hoisted(() => ({ links: { findByLocal: vi.fn() } }));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  findByLocal: (...a: unknown[]) => links.findByLocal(...a),
  findBySg: vi.fn(),
  mapSgToLocal: vi.fn(),
  upsertLink: vi.fn(),
}));

import { localTarget } from './ShotgridPullService';

interface Row {
  id: number;
  name: string;
}

/** Une base en mémoire : ce sont les règles qu'on teste, pas Prisma. */
function table(rows: Row[]) {
  return {
    findById: async (id: number) => rows.find((r) => r.id === id) ?? null,
    findByName: async (name: string) => rows.find((r) => r.name === name) ?? null,
  };
}

const call = (rows: Row[], sgId: number, sgName: string, linkedId: number | null) =>
  localTarget<Row>({
    connectionId: 1,
    localType: 'sequence',
    sgId,
    sgName,
    linkedId,
    ...table(rows),
  });

beforeEach(() => {
  vi.clearAllMocks();
  links.findByLocal.mockResolvedValue(null);
});

describe('localTarget', () => {
  it('crée sous le nom du site quand personne ne le porte', async () => {
    const r = await call([], 4685, 'sq010', null);
    expect(r).toEqual({ existing: null, name: 'sq010' });
  });

  it('adopte une entité créée avant la liaison', async () => {
    // Un studio a saisi ses séquences à la main puis relie le projet : on reprend
    // l'existant plutôt que d'en fabriquer un double.
    const rows = [{ id: 7, name: 'sq010' }];
    const r = await call(rows, 4685, 'sq010', null);
    expect(r.existing?.id).toBe(7);
    expect(r.name).toBe('sq010');
  });

  it('n’adopte pas une entité déjà contrepartie d’une autre du site', async () => {
    links.findByLocal.mockResolvedValue({ sgId: 4685 });
    const rows = [{ id: 7, name: 'DO_NOT_USE_' }];

    const r = await call(rows, 4686, 'DO_NOT_USE_', null);

    expect(r.existing).toBeNull();
    expect(r.name).toBe('DO_NOT_USE_ (4686)');
  });

  it('retrouve la désambiguïsée au lieu d’en créer une deuxième', async () => {
    links.findByLocal.mockImplementation(async (_c: number, _t: string, id: number) =>
      id === 7 ? { sgId: 4685 } : null,
    );
    const rows = [
      { id: 7, name: 'DO_NOT_USE_' },
      { id: 8, name: 'DO_NOT_USE_ (4686)' },
    ];

    const r = await call(rows, 4686, 'DO_NOT_USE_', null);

    expect(r.existing?.id).toBe(8);
    expect(r.name).toBe('DO_NOT_USE_ (4686)');
  });

  it('garde son suffixe à la passe suivante, une fois liée', async () => {
    // Le cas qui a cassé en production : l'entité est liée, donc trouvée par son id, et
    // on la renommait vers le nom du site — que sa jumelle porte toujours.
    const rows = [
      { id: 7, name: 'DO_NOT_USE_' },
      { id: 8, name: 'DO_NOT_USE_ (4686)' },
    ];

    const r = await call(rows, 4686, 'DO_NOT_USE_', 8);

    expect(r.existing?.id).toBe(8);
    expect(r.name).toBe('DO_NOT_USE_ (4686)');
  });

  it('laisse la première garder le nom du site', async () => {
    const rows = [
      { id: 7, name: 'DO_NOT_USE_' },
      { id: 8, name: 'DO_NOT_USE_ (4686)' },
    ];

    const r = await call(rows, 4685, 'DO_NOT_USE_', 7);

    expect(r.existing?.id).toBe(7);
    expect(r.name).toBe('DO_NOT_USE_');
  });

  it('rend une entité renommée à son nom du site quand il se libère', async () => {
    // La jumelle a été supprimée côté site : plus rien ne justifie le suffixe.
    const rows = [{ id: 8, name: 'DO_NOT_USE_ (4686)' }];

    const r = await call(rows, 4686, 'DO_NOT_USE_', 8);

    expect(r.existing?.id).toBe(8);
    expect(r.name).toBe('DO_NOT_USE_');
  });
});
