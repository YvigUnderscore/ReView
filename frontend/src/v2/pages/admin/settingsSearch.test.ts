// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { t } from '../../i18n';
import {
  SECTION_KEYWORDS,
  SECTION_SETTING_LABELS,
  fold,
  sectionHaystack,
  sectionMatches,
} from './settingsSearch';
import { adminSections } from './adminSections';

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

  /**
   * Le registre ne déclarait que les douze réglages clé/valeur, pour une soixantaine
   * réellement rendus : « CRF », « slate », « STARTTLS », « taille de lot » ou « scopes »
   * ne menaient nulle part — c'est-à-dire exactement les réglages qu'on ne retrouve pas de
   * tête. Chacun est désormais indexé dans la section qui le rend.
   */
  it('indexe les réglages que les sections rendent vraiment, pas seulement les clé/valeur', () => {
    const cas: [string, string][] = [
      ['video', t('transcode.crf')],
      ['video', t('transcode.audioKbps')],
      ['distribution', t('burnin.slateShort')],
      ['smtp', t('smtp.allowInsecure')],
      ['retention', t('retention.batchSize')],
      ['api', t('webhooks.hmacSecret')],
      ['identity', t('sso.clientSecret')],
      ['shotgrid', t('shotgrid.site.scriptKey')],
      ['service-tokens', t('tokens.allProjects')],
      ['jobs', t('jobs.purgeDerived')],
      ['login-appearance', t('login.appearance.tagline')],
      ['defaults', t('settings.draftMode')],
    ];
    for (const [key, label] of cas) {
      expect(sectionMatches(haystackOf(key), label), `${key} / ${label}`).toBe(true);
    }
  });

  it('ne déclare que des sections qui existent — un renommage ne laisse pas d’index orphelin', () => {
    // `Set<string>` et non `Set<SectionKey>` : on interroge justement avec des clés BRUTES,
    // celles des deux index, pour attraper un renommage que le typage ne verrait pas.
    const connues = new Set<string>(adminSections(t).map((s) => s.key));
    for (const key of Object.keys(SECTION_SETTING_LABELS)) expect(connues.has(key), key).toBe(true);
    for (const key of Object.keys(SECTION_KEYWORDS)) expect(connues.has(key), key).toBe(true);
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
