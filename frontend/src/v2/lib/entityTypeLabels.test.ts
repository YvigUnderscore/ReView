// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { t } from '../i18n';
import { assetTypeLabel, taskTypeLabel, titleCase } from './entityTypeLabels';

/**
 * Les filtres de l'onglet Assets et du kanban affichaient `CHARACTER`, `PROP`, `LOOKDEV` —
 * des identifiants de base, en capitales, au milieu d'une interface rédigée.
 */
describe('assetTypeLabel', () => {
  it('traduit les types connus', () => {
    expect(assetTypeLabel(t, 'CHARACTER')).toBe('Character');
    expect(assetTypeLabel(t, 'ENVIRONMENT')).toBe('Environment');
  });

  it('laisse FX tel quel — c’est du vocabulaire de production', () => {
    expect(assetTypeLabel(t, 'FX')).toBe('FX');
  });

  it('se rabat sur une casse lisible pour un type inconnu, jamais sur la clé', () => {
    expect(assetTypeLabel(t, 'MATTE_PAINTING')).toBe('Matte Painting');
    expect(assetTypeLabel(t, 'MACHIN')).not.toContain('assetType.');
  });
});

describe('taskTypeLabel', () => {
  it('garde le vocabulaire de département, en casse normale', () => {
    expect(taskTypeLabel(t, 'LOOKDEV')).toBe('Look Dev');
    expect(taskTypeLabel(t, 'COMPOSITING')).toBe('Compositing');
    expect(taskTypeLabel(t, 'FX')).toBe('FX');
  });

  it('reste lisible sur un type qu’il ne connaît pas', () => {
    expect(taskTypeLabel(t, 'MATCHMOVE')).toBe('Matchmove');
  });

  it('traduit « Autre », qui n’est pas un nom de département', () => {
    expect(taskTypeLabel(t, 'OTHER')).toBe('Other');
  });
});

describe('titleCase', () => {
  it('sait lire les séparateurs des identifiants de base', () => {
    expect(titleCase('LOOK_DEV')).toBe('Look Dev');
    expect(titleCase('matte-painting')).toBe('Matte Painting');
    expect(titleCase('')).toBe('');
  });
});
