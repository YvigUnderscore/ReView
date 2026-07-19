import { describe, it, expect } from 'vitest';
import {
  applyPipelineOverride,
  pipelineOf,
  resolveEntitySettings,
  checkNaming,
  projectSettingsSchema,
  type ProjectSettings,
  type PipelineSettings,
} from './projectSettings';

const project: ProjectSettings = {
  departments: [],
  nomenclature: { sequencePrefix: 'SQ', shotPrefix: 'SH', padding: 3, step: 10 },
  naming: { pattern: '', mode: 'off' },
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
};

const base: PipelineSettings = { resolution: { width: 1920, height: 1080 }, framerate: 24 };

describe('projectSettings — pipeline & héritage (Phase 18)', () => {
  it('pipelineOf extrait résolution + framerate des réglages projet', () => {
    expect(pipelineOf(project)).toEqual({ resolution: { width: 1920, height: 1080 }, framerate: 24 });
  });

  it('applyPipelineOverride laisse hériter quand le JSON est vide', () => {
    expect(applyPipelineOverride(base, {})).toEqual(base);
    expect(applyPipelineOverride(base, null)).toEqual(base);
    expect(applyPipelineOverride(base, undefined)).toEqual(base);
  });

  it('applyPipelineOverride surcharge résolution et framerate présents', () => {
    const out = applyPipelineOverride(base, { resolution: { width: 3840, height: 2160 }, framerate: 30 });
    expect(out).toEqual({ resolution: { width: 3840, height: 2160 }, framerate: 30 });
  });

  it('applyPipelineOverride surcharge partiellement (framerate seul)', () => {
    const out = applyPipelineOverride(base, { framerate: 25 });
    expect(out).toEqual({ resolution: { width: 1920, height: 1080 }, framerate: 25 });
  });

  it('applyPipelineOverride borne les dimensions et le framerate', () => {
    const out = applyPipelineOverride(base, { resolution: { width: 0, height: 999999 }, framerate: 9999 });
    expect(out.resolution.width).toBe(1); // borné min
    expect(out.resolution.height).toBe(16384); // borné max
    expect(out.framerate).toBe(240); // borné max
  });

  it('applyPipelineOverride ignore les valeurs non numériques', () => {
    const out = applyPipelineOverride(base, { framerate: 'abc', resolution: { width: 'x' } });
    expect(out.resolution.width).toBe(1920); // hérité (invalide ignoré)
    expect(out.framerate).toBe(24); // hérité
  });

  it('resolveEntitySettings hérite du projet sans override', () => {
    expect(resolveEntitySettings(project)).toEqual(base);
  });

  it("resolveEntitySettings applique l'override séquence puis shot (le plus proche gagne)", () => {
    const out = resolveEntitySettings(
      project,
      { resolution: { width: 2048, height: 858 }, framerate: 25 }, // séquence
      { framerate: 48 }, // shot surcharge le framerate uniquement
    );
    expect(out).toEqual({ resolution: { width: 2048, height: 858 }, framerate: 48 });
  });

  it('resolveEntitySettings : shot hérite de la résolution de la séquence', () => {
    const out = resolveEntitySettings(project, { resolution: { width: 1280, height: 720 } }, {});
    expect(out).toEqual({ resolution: { width: 1280, height: 720 }, framerate: 24 });
  });
});

describe('projectSettings — checkNaming (38.C)', () => {
  it('passe toujours si mode off ou motif vide', () => {
    expect(checkNaming('x.mov', { pattern: '', mode: 'reject' })).toEqual({ pass: true, mode: 'off' });
    expect(checkNaming('x.mov', { pattern: '^SH\\d+', mode: 'off' })).toEqual({ pass: true, mode: 'off' });
    expect(checkNaming('x.mov', undefined)).toEqual({ pass: true, mode: 'off' });
  });

  it('évalue le motif et renvoie le mode (warn/reject)', () => {
    expect(checkNaming('SH010_v2.mov', { pattern: '^SH\\d{3}_v\\d+', mode: 'reject' })).toEqual({
      pass: true,
      mode: 'reject',
    });
    expect(checkNaming('mauvais.mov', { pattern: '^SH\\d{3}_v\\d+', mode: 'warn' })).toEqual({
      pass: false,
      mode: 'warn',
    });
  });

  it('regex invalide n’entrave jamais l’upload', () => {
    expect(checkNaming('x.mov', { pattern: '([', mode: 'reject' })).toEqual({ pass: true, mode: 'off' });
  });
});

describe('projectSettings — defaultLighting (39.F)', () => {
  const valid = {
    hdriId: 'clh123',
    exposure: 1.5,
    rotationDeg: 45,
    showBackground: true,
    groundShadow: true,
  };

  it('accepte un éclairage par défaut complet', () => {
    const parsed = projectSettingsSchema.parse({ defaultLighting: valid });
    expect(parsed.defaultLighting).toEqual(valid);
  });

  it('accepte sans hdriId (éclairage neutre par défaut)', () => {
    const parsed = projectSettingsSchema.parse({
      defaultLighting: { exposure: 1, rotationDeg: 0, showBackground: false, groundShadow: false },
    });
    expect(parsed.defaultLighting?.hdriId).toBeUndefined();
  });

  it('rejette une exposition hors bornes', () => {
    expect(() => projectSettingsSchema.parse({ defaultLighting: { ...valid, exposure: 99 } })).toThrow();
  });

  it('rejette une rotation hors bornes', () => {
    expect(() => projectSettingsSchema.parse({ defaultLighting: { ...valid, rotationDeg: 400 } })).toThrow();
  });
});
