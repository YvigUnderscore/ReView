// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, log } = vi.hoisted(() => ({
  db: { shotgridLink: { findMany: vi.fn(), delete: vi.fn(), upsert: vi.fn() } },
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));
vi.mock('../../lib/logger', () => ({ logger: log }));

import { listForUi, shouldImportMedia, upsertLink, UI_LINK_TYPES, UI_LINKS_LIMIT } from './shotgridLinks';
import { AppError } from '../../lib/errors';

const link = (id: number, localType = 'shot') => ({
  localType,
  localId: id,
  sgId: 1000 + id,
  sgType: 'Shot',
  syncedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.shotgridLink.findMany.mockResolvedValue([link(1), link(2)]);
});

describe('listForUi', () => {
  it('borne la table de correspondance servie à l’interface', async () => {
    // La requête n'était pas bornée : à 2 000 plans, 10 000 tâches et 20 000 versions,
    // elle renvoyait plusieurs mégaoctets de JSON par ouverture de projet.
    await listForUi(12);
    expect(db.shotgridLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: UI_LINKS_LIMIT }));
  });

  it('trie par type puis id local : la troncature rogne d’abord les versions', async () => {
    // `version` est le dernier type dans l'ordre alphabétique — la dégradation touche
    // donc ce qui s'affiche le moins, jamais les plans ou les tâches.
    await listForUi(12);
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ localType: 'asc' }, { localId: 'asc' }]);
    expect([...UI_LINK_TYPES].sort().at(-1)).toBe('version');
  });

  it('interroge par défaut les cinq types que l’interface affiche', async () => {
    await listForUi(12);
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as {
      where: { connectionId: number; localType: { in: string[] } };
    };
    expect(args.where.connectionId).toBe(12);
    expect(args.where.localType.in).toEqual([...UI_LINK_TYPES]);
  });

  it('accepte un filtre de types pour un écran qui n’en affiche qu’un', async () => {
    await listForUi(12, { localTypes: ['shot'] });
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as {
      where: { localType: { in: string[] } };
    };
    expect(args.where.localType.in).toEqual(['shot']);
  });

  it('ne laisse pas un appelant franchir le plafond', async () => {
    await listForUi(12, { limit: 10 ** 9 });
    expect(db.shotgridLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: UI_LINKS_LIMIT }));
  });

  it('journalise la troncature : une pastille absente se lit « non liée »', async () => {
    db.shotgridLink.findMany.mockResolvedValue([link(1), link(2)]);
    await listForUi(12, { limit: 2 });
    expect(log.warn).toHaveBeenCalledWith({ connectionId: 12, limit: 2 }, 'shotgrid links truncated for UI');
  });

  it('se tait quand rien n’a été coupé', async () => {
    await listForUi(12);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('rend les colonnes que l’interface consomme, et pas les données du lien', async () => {
    await listForUi(12);
    const args = db.shotgridLink.findMany.mock.calls[0]![0] as { select: Record<string, boolean> };
    expect(args.select).toEqual({
      localType: true,
      localId: true,
      sgId: true,
      sgType: true,
      syncedAt: true,
    });
  });
});

describe('upsertLink — conflits', () => {
  const params = {
    connectionId: 12,
    localType: 'media' as const,
    localId: 4,
    sgType: 'Attachment',
    sgId: 412,
  };

  beforeEach(() => {
    db.shotgridLink.upsert.mockResolvedValue({ id: 1 });
  });

  it('refuse d’écraser le lien d’un AUTRE type local', async () => {
    // Le scénario du lien menteur : `('Attachment', 412)` désignant en réalité la
    // Version 412 venait effacer la correspondance du véritable Attachment 412. Un
    // identifiant ShotGrid ne désigne qu'un seul type local — remplacer était une
    // corruption, pas un rebranchement.
    db.shotgridLink.findMany.mockResolvedValue([
      { id: 9, localType: 'comment', localId: 77, sgType: 'Attachment', sgId: 412 },
    ]);
    await expect(upsertLink(params)).rejects.toBeInstanceOf(AppError);
    expect(db.shotgridLink.delete).not.toHaveBeenCalled();
    expect(db.shotgridLink.upsert).not.toHaveBeenCalled();
  });

  it('accepte un rebranchement de même type mais le journalise', async () => {
    // Cas légitime : l'entité distante a été recréée sur le site avec un nouvel
    // identifiant. Le lien précédent part — l'entité délaissée redevient « jamais
    // importée » et sera recréée chez le client : ça se trace.
    db.shotgridLink.findMany.mockResolvedValue([
      { id: 9, localType: 'media', localId: 4, sgType: 'Attachment', sgId: 99 },
    ]);
    await upsertLink(params);
    expect(db.shotgridLink.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), 'shotgrid link rebound');
    expect(db.shotgridLink.upsert).toHaveBeenCalled();
  });

  it('retire TOUS les conflits, pas seulement le premier', async () => {
    // Un lien peut heurter les deux uniques à la fois, sur deux lignes distinctes :
    // n'en retirer qu'une laissait l'upsert buter sur l'autre contrainte.
    db.shotgridLink.findMany.mockResolvedValue([
      { id: 9, localType: 'media', localId: 4, sgType: 'Attachment', sgId: 99 },
      { id: 10, localType: 'media', localId: 5, sgType: 'Attachment', sgId: 412 },
    ]);
    await upsertLink(params);
    expect(db.shotgridLink.delete).toHaveBeenCalledTimes(2);
  });

  it('n’écrit et ne supprime rien de plus quand la voie est libre', async () => {
    db.shotgridLink.findMany.mockResolvedValue([]);
    await upsertLink(params);
    expect(db.shotgridLink.delete).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(db.shotgridLink.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('shouldImportMedia (garde-fou inchangé)', () => {
  it('ne réimporte pas un média né dans ReView', () => {
    expect(shouldImportMedia({ withMedia: true, autoImport: true, link: { createdFromReview: true } })).toBe(
      false,
    );
    expect(shouldImportMedia({ withMedia: true, autoImport: true, link: {} })).toBe(true);
  });
});
