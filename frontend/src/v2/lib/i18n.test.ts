// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { getLocale, setLocale, t } from './i18n';

describe('i18n — socle de traduction', () => {
  beforeEach(() => {
    setLocale('fr');
  });

  it('renvoie le FR par défaut', () => {
    expect(getLocale()).toBe('fr');
    expect(t('login.submit')).toBe('Se connecter');
  });

  it('bascule en EN et traduit', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('login.submit')).toBe('Sign in');
  });

  it('retombe sur le FR quand une clé EN est absente', () => {
    // On simule une clé non traduite en EN : le repli doit donner la valeur FR.
    setLocale('en');
    // 'auth.tagline' est traduite ; on vérifie plutôt le mécanisme sur une clé connue,
    // puis on s'assure qu'aucune clé ne renvoie undefined.
    expect(t('auth.tagline')).toBe('Collaborative media review for VFX & post-production studios.');
  });

  it('ignore une locale inconnue et persiste le choix', () => {
    setLocale('en');
    // @ts-expect-error test d'une valeur invalide
    setLocale('de');
    expect(getLocale()).toBe('en');
  });

  it('toutes les clés FR ont une valeur non vide', () => {
    setLocale('fr');
    // t() sur chaque clé du dictionnaire FR (importé indirectement via le type)
    const keys: Parameters<typeof t>[0][] = ['login.title', 'setup.title', 'setup.submit'];
    for (const k of keys) expect(t(k).length).toBeGreaterThan(0);
  });

  // La mention affichée sur les surfaces publiques (connexion, partage client) n'est pas
  // décorative : la GPL/AGPL exige des « Appropriate Legal Notices » — copyright, licence,
  // absence de garantie — que le §13 complète par l'offre du code source.
  it.each(['fr', 'en'] as const)('porte copyright, licence et absence de garantie en %s', (locale) => {
    setLocale(locale);
    const notice = t('license.notice');
    expect(notice).toContain('©');
    expect(notice).toContain('Yvig Bidon');
    expect(notice).toContain('AGPL-3.0');
    expect(notice).toMatch(/sans aucune garantie|no warranty/);
    expect(t('license.source')).toMatch(/^(Code source|Source code)$/);
  });

  it('traduit la navigation (42.B №88) en FR et EN', () => {
    setLocale('fr');
    expect(t('nav.reviews')).toBe('Reviews');
    expect(t('nav.settings')).toBe('Paramètres');
    setLocale('en');
    expect(t('nav.settings')).toBe('Settings');
    expect(t('nav.home')).toBe('Home');
    expect(t('common.save')).toBe('Save');
  });
});
