// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A2-04 — `PATCH /api/users/me/preferences` validait `z.record(z.string().max(64),
 * z.unknown())` : la CLÉ était bornée, la VALEUR non. N'importe quel compte ordinaire
 * écrivait donc du JSON de forme et de profondeur libres dans sa colonne `preferences`, et
 * la fusion étant superficielle, chaque appel AJOUTAIT une clé sans jamais en reprendre.
 *
 * Deux moitiés se répondent ici : le schéma borne ce qu'une valeur a le droit d'être, la
 * fusion borne ce que le sac a le droit de devenir.
 */

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('./InvitationService', () => ({ sendInvitation: vi.fn() }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: { avatarKey: vi.fn() },
}));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: vi.fn(() => []) }));
vi.mock('../lib/userCache', () => ({ invalidateAuthUser: vi.fn() }));
vi.mock('../lib/sessions', () => ({ revokeAllCredentials: vi.fn() }));
vi.mock('../lib/userView', () => ({ toPublicUser: vi.fn() }));

import { preferencesPatchSchema, updatePreferences } from './UserService';

const accepts = (value: unknown) => preferencesPatchSchema.safeParse({ k: value }).success;

/** Sac déjà en base pour ce compte. */
const stored = (preferences: Record<string, unknown>) =>
  db.user.findUnique.mockResolvedValue({ preferences });

const manyKeys = (n: number, prefix = 'k') =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, true]));

beforeEach(() => {
  vi.clearAllMocks();
  db.user.update.mockResolvedValue({});
});

describe('preferencesPatchSchema — ce que l’interface enregistre réellement passe', () => {
  it('accepte les préférences existantes, imbriquées comprises', () => {
    const real = {
      emailDigest: true,
      annotationColor: '#ef4444',
      locale: 'fr',
      density: 'compact',
      shortcuts: { 'review.next': 'ArrowRight' },
      savedViews: { 'shots:12': [{ id: 'v1', name: 'Retakes', filters: { status: 'RETAKE' } }] },
      homeWidgets: { hidden: ['calendar'], order: ['tasks'], settings: { tasks: { limit: 5 } } },
      onboardingSeen: null,
    };
    expect(preferencesPatchSchema.safeParse(real).success).toBe(true);
  });

  it('refuse une chaîne démesurée — un champ ne peut pas manger tout le budget', () => {
    expect(accepts('x'.repeat(4_000))).toBe(true);
    expect(accepts('x'.repeat(4_001))).toBe(false);
  });

  it('refuse une imbrication sans fond', () => {
    const nest = (depth: number): unknown => (depth === 0 ? 1 : { a: nest(depth - 1) });
    expect(accepts(nest(5))).toBe(true);
    expect(accepts(nest(7))).toBe(false);
  });

  it('refuse un tableau ou un sous-objet démesuré', () => {
    expect(accepts(Array.from({ length: 501 }, () => 1))).toBe(false);
    expect(accepts(manyKeys(201, 'n'))).toBe(false);
  });

  it('refuse une clé de premier niveau trop longue', () => {
    expect(preferencesPatchSchema.safeParse({ ['k'.repeat(65)]: true }).success).toBe(false);
  });
});

describe('updatePreferences — le sac ne grossit pas indéfiniment', () => {
  it('refuse d’ajouter une clé de plus au-delà du plafond, sans rien écrire', async () => {
    stored(manyKeys(200));
    await expect(updatePreferences(7, { unDeTrop: true })).rejects.toMatchObject({
      code: 'PREFERENCES_TOO_MANY_KEYS',
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('laisse remplacer une clé existante à plafond atteint', async () => {
    stored(manyKeys(200));
    await expect(updatePreferences(7, { k0: false })).resolves.toMatchObject({ k0: false });
  });

  /** Un sac antérieur au plafond doit rester réductible, sinon le refus enferme. */
  it('laisse reprendre des clés à un sac déjà trop garni', async () => {
    stored(manyKeys(260));
    await expect(updatePreferences(7, { k0: null })).resolves.toBeTruthy();
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });
});

/**
 * La disposition de la vue d'ensemble (lot 10) a, comme les réglages de notification, une
 * FORME arrêtée dans le sac : ce qui s'y écrit doit citer des blocs que l'écran sait rendre.
 */
describe('preferencesPatchSchema — disposition de la vue d’ensemble', () => {
  const layout = (value: unknown) => preferencesPatchSchema.safeParse({ projectOverview: value }).success;

  it('accepte ce que compose réellement la page', () => {
    expect(
      layout({
        hidden: ['counts'],
        order: ['myTasks', 'activity', 'counts'],
        settings: { activity: { span: 6, density: 'compact' } },
      }),
    ).toBe(true);
  });

  it('accepte l’effacement — c’est le retour au défaut du rôle', () => {
    expect(layout(null)).toBe(true);
  });

  it('refuse un bloc que l’écran ne saurait pas rendre', () => {
    expect(layout({ order: ['fantome'] })).toBe(false);
  });

  it('laisse passer les autres clés du sac sans les regarder', () => {
    expect(preferencesPatchSchema.safeParse({ density: 'compact' }).success).toBe(true);
  });
});

describe('updatePreferences — la disposition est bien persistée', () => {
  it('écrit la clé sans toucher au reste du sac', async () => {
    stored({ density: 'compact' });
    const next = await updatePreferences(7, { projectOverview: { hidden: ['counts'] } });
    expect(next).toEqual({ density: 'compact', projectOverview: { hidden: ['counts'] } });
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it('supprime la clé quand la personne revient au défaut de son rôle', async () => {
    stored({ density: 'compact', projectOverview: { hidden: ['counts'] } });
    const next = await updatePreferences(7, { projectOverview: null });
    expect(next).toEqual({ density: 'compact' });
  });
});
