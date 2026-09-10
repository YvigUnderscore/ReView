// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { t } from '../../i18n';
import { SECTION_KEYWORDS, fold, sectionHaystack, sectionMatches } from './settingsSearch';

/**
 * Vingt-huit sections en cinq groupes, sans aucun moyen de chercher : pour trouver le
 * watermark il fallait savoir qu'il vit dans « Diffusion », et pour la rétention des
 * journaux qu'elle n'est pas au même endroit que celle de la corbeille.
 */
const haystackOf = (key: string, label = '') => sectionHaystack(key, label, t);

describe('recherche dans les réglages', () => {
  it('trouve une section par un mot qu’on emploie vraiment, pas par son titre', () => {
    // Personne ne cherche « Diffusion » : on cherche « watermark ».
    expect(sectionMatches(haystackOf('distribution'), 'watermark')).toBe(true);
    expect(sectionMatches(haystackOf('distribution'), 'filigrane')).toBe(true);
    expect(sectionMatches(haystackOf('distribution'), 'burn-in')).toBe(true);
  });

  it('ignore la casse et les accents', () => {
    expect(sectionMatches(haystackOf('retention'), 'RÉTENTION')).toBe(true);
    expect(sectionMatches(haystackOf('retention'), 'retention')).toBe(true);
  });

  it('exige tous les mots : « quota slack » ne rend pas la moitié de l’administration', () => {
    expect(sectionMatches(haystackOf('storage'), 'quota slack')).toBe(false);
    expect(sectionMatches(haystackOf('storage'), 'stockage bucket')).toBe(true);
  });

  /**
   * Chaque réglage est indexé dans la section qui le rend. Tant que les quatorze vivaient au
   * même endroit, chercher « quota » ou « corbeille » ramenait toujours le même écran —
   * celui qui les empilait tous.
   */
  it('indexe chaque réglage dans la section qui le rend, et nulle part ailleurs', () => {
    expect(haystackOf('storage')).toContain(fold(t('settings.maxUploads')));
    expect(haystackOf('storage')).toContain(fold(t('settings.storageQuota')));
    expect(haystackOf('retention')).toContain(fold(t('settings.trashRetention')));
    expect(haystackOf('chat')).toContain(fold(t('settings.slackWebhook')));
    expect(haystackOf('defaults')).toContain(fold(t('settings.defaultStartFrame')));
    // La section « Réglages » ne les porte plus : elle ne garde que l'identité du studio.
    expect(haystackOf('settings')).not.toContain(fold(t('settings.maxUploads')));
    expect(haystackOf('settings')).not.toContain(fold(t('settings.trashRetention')));
  });

  it('laisse tout passer quand la recherche est vide', () => {
    expect(sectionMatches(haystackOf('jobs'), '')).toBe(true);
    expect(sectionMatches(haystackOf('jobs'), '   ')).toBe(true);
  });

  it('ne trouve rien sur un mot absent — le message « aucun réglage » doit pouvoir sortir', () => {
    expect(sectionMatches(haystackOf('jobs'), 'zzzz')).toBe(false);
  });

  it('couvre chaque section par au moins un mot-clé', () => {
    expect(Object.keys(SECTION_KEYWORDS).length).toBeGreaterThanOrEqual(28);
    for (const [key, words] of Object.entries(SECTION_KEYWORDS)) {
      expect(words.length, key).toBeGreaterThan(0);
    }
  });
});

describe('fold', () => {
  it('replie accents et casse', () => {
    expect(fold('Éléments Masqués')).toBe('elements masques');
  });
});
