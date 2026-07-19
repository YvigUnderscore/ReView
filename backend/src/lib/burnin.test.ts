import { describe, it, expect } from 'vitest';
import {
  BURNIN_FALLBACK,
  escapeDrawtext,
  buildBurninFilters,
  buildSlateLines,
  buildSlateFilters,
  type BurninConfig,
} from './burnin';

const cfg = (patch: Partial<BurninConfig> = {}): BurninConfig => ({
  ...BURNIN_FALLBACK,
  enabled: true,
  ...patch,
});

const ctx = { shotLabel: 'SQ010 · SH020', versionLabel: 'v003', fps: 24 };

describe('escapeDrawtext', () => {
  it('neutralise les caractères du parser de filtres', () => {
    expect(escapeDrawtext('a:b,c;d[e]')).toBe('a\\:b\\,c\\;d\\[e\\]');
    expect(escapeDrawtext('50%')).toBe('50\\%');
    expect(escapeDrawtext("l'ombre")).toBe('l’ombre');
    expect(escapeDrawtext('back\\slash')).toBe('back\\\\slash');
  });
});

describe('buildBurninFilters', () => {
  it('vide quand désactivé', () => {
    expect(buildBurninFilters({ ...BURNIN_FALLBACK, enabled: false }, ctx, 1080)).toEqual([]);
  });

  it('shot + version + timecode par défaut', () => {
    const f = buildBurninFilters(cfg(), ctx, 1080);
    expect(f).toHaveLength(3);
    expect(f[0]).toContain("text='SQ010 · SH020'");
    expect(f[1]).toContain("text='v003'");
    expect(f[1]).toContain('x=w-tw-');
    expect(f[2]).toContain("timecode='00\\:00\\:00\\:00'");
    expect(f[2]).toContain('rate=24');
  });

  it('ignore les éléments sans donnée et ajoute le texte libre', () => {
    const f = buildBurninFilters(
      cfg({ customText: 'CONFIDENTIEL', showTimecode: false }),
      { shotLabel: null, versionLabel: null, fps: null },
      720,
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("text='CONFIDENTIEL'");
  });

  it('fontsize proportionnel à la hauteur et fps arrondi', () => {
    const f1080 = buildBurninFilters(cfg(), ctx, 1080);
    const f360 = buildBurninFilters(cfg(), { ...ctx, fps: 23.976 }, 360);
    expect(f1080[0]).toContain('fontsize=34');
    expect(f360[0]).toContain('fontsize=11');
    expect(f360[2]).toContain('rate=24');
  });
});

describe('slate', () => {
  it('construit les lignes sans champ vide', () => {
    const lines = buildSlateLines({
      studioName: 'Studio X',
      projectName: 'Film',
      shotLabel: null,
      versionLabel: 'v001',
      authorName: null,
      fileName: 'shot.mov',
      date: '2026-07-19',
    });
    expect(lines).toEqual([
      'Studio X',
      'Projet : Film',
      'Version : v001',
      'Fichier : shot.mov',
      '2026-07-19',
    ]);
  });

  it('génère un drawtext centré par ligne, titre plus grand', () => {
    const f = buildSlateFilters(['Titre', 'Ligne'], 1080);
    expect(f).toHaveLength(2);
    expect(f[0]).toContain('x=(w-tw)/2');
    const size = (s: string) => Number(/fontsize=(\d+)/.exec(s)?.[1]);
    expect(size(f[0])).toBeGreaterThan(size(f[1]));
  });
});
