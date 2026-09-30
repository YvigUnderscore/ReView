// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le ratio du cadre de review vient des réglages pipeline, et de nulle part ailleurs.
 *
 * L'infobulle du format promettait « hérité des réglages pipeline du shot » alors que
 * l'aspect se recopiait depuis la présentation caméra — c'est-à-dire depuis le défaut 16/9,
 * gelé au premier enregistrement de mise en scène. Ce banc éprouve la chaîne réelle :
 * studio → projet → séquence → plan, chaque échelon écrasant l'amont quand il se prononce.
 */

const { db } = vi.hoisted(() => ({ db: { version: { findUnique: vi.fn() } } }));

vi.mock('./prisma', () => ({ prisma: db }));
// `resolveEntitySettings` reste RÉEL : c'est la règle d'héritage qu'on veut voir s'appliquer.
// Seule la lecture des réglages du projet est simulée (elle interroge studio + départements).
vi.mock('./projectSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./projectSettings')>()),
  resolveProjectSettingsById: vi.fn(),
}));

import { aspectOfResolution, DEFAULT_DELIVERY_ASPECT, resolveDeliveryAspect } from './deliveryAspect';
import { resolveProjectSettingsById } from './projectSettings';

const VERSION = 12;
const PROJECT = 3;

/** Réglages projet minimaux — seule la résolution intéresse ce banc. */
const projectSettings = (width: number, height: number) =>
  ({ resolution: { width, height }, framerate: 24 }) as never;

/** Version rattachée à un plan, avec les overrides pipeline de la séquence et du plan. */
const versionUnder = (sequence: unknown, shot: unknown) => ({
  task: { shot: { settings: shot, sequence: { settings: sequence } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(1920, 1080));
});

describe('aspectOfResolution', () => {
  it('rend le ratio largeur/hauteur de la résolution de livraison', () => {
    expect(aspectOfResolution({ width: 2048, height: 858 })).toBeCloseTo(2048 / 858);
  });

  // Un aspect non fini produit un cadre de hauteur nulle, c'est-à-dire un viewer vide.
  it('retombe sur 16:9 devant une résolution absente ou aberrante', () => {
    expect(aspectOfResolution(undefined)).toBeCloseTo(DEFAULT_DELIVERY_ASPECT);
    expect(aspectOfResolution({ width: 0, height: 1080 })).toBeCloseTo(DEFAULT_DELIVERY_ASPECT);
    expect(aspectOfResolution({ width: 1920, height: Number.NaN })).toBeCloseTo(DEFAULT_DELIVERY_ASPECT);
  });
});

describe('resolveDeliveryAspect — héritage studio → projet → séquence → plan', () => {
  it('prend la résolution du PLAN quand il se prononce', async () => {
    db.version.findUnique.mockResolvedValue(
      versionUnder(
        { resolution: { width: 1998, height: 1080 } },
        { resolution: { width: 2048, height: 858 } },
      ),
    );
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(2048 / 858);
  });

  it('retombe sur la SÉQUENCE quand le plan ne se prononce pas', async () => {
    db.version.findUnique.mockResolvedValue(
      versionUnder({ resolution: { width: 1998, height: 1080 } }, null),
    );
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(1998 / 1080);
  });

  it('retombe sur le PROJET quand ni le plan ni la séquence ne se prononcent', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(4096, 1716));
    db.version.findUnique.mockResolvedValue(versionUnder(null, null));
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(4096 / 1716);
  });

  // `resolveProjectSettingsById` complète déjà le projet par les défauts du studio : une
  // version hors plan (asset, livraison sans tâche) hérite donc de cette valeur-là.
  it('prend le ratio du projet quand la version ne pend à aucun plan', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(1920, 1080));
    db.version.findUnique.mockResolvedValue({ task: null });
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(16 / 9);
  });

  it('n’hérite que d’un axe quand l’échelon n’en surcharge qu’un', async () => {
    vi.mocked(resolveProjectSettingsById).mockResolvedValue(projectSettings(4096, 2160));
    db.version.findUnique.mockResolvedValue(versionUnder(null, { resolution: { height: 1716 } }));
    expect(await resolveDeliveryAspect(VERSION, PROJECT)).toBeCloseTo(4096 / 1716);
  });

  it('interroge le plan de LA version demandée, séquence comprise', async () => {
    db.version.findUnique.mockResolvedValue(versionUnder(null, null));
    await resolveDeliveryAspect(VERSION, PROJECT);
    expect(db.version.findUnique).toHaveBeenCalledWith({
      where: { id: VERSION },
      select: {
        task: { select: { shot: { select: { settings: true, sequence: { select: { settings: true } } } } } },
      },
    });
    expect(vi.mocked(resolveProjectSettingsById)).toHaveBeenCalledWith(PROJECT);
  });
});
