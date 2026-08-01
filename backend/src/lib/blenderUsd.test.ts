import { describe, it, expect } from 'vitest';
import {
  BLENDER_SUMMARY_MARKER,
  buildBlenderArgs,
  isUsdPurpose,
  parseBlenderSummary,
  summarizeBlenderError,
} from './blenderUsd';

describe('isUsdPurpose', () => {
  it('n’accepte que les purposes USD connus', () => {
    expect(isUsdPurpose('render')).toBe(true);
    expect(isUsdPurpose('proxy')).toBe(true);
    expect(isUsdPurpose('default')).toBe(false);
    expect(isUsdPurpose(42)).toBe(false);
  });
});

describe('buildBlenderArgs', () => {
  const base = { input: '/tmp/scene.usda', output: '/tmp/model.glb' };

  it('lance Blender en headless sans préférences utilisateur', () => {
    const args = buildBlenderArgs('/srv/usd_to_glb.py', base);
    expect(args.slice(0, 5)).toEqual(['-b', '--factory-startup', '--python-exit-code', '1', '--python']);
    // Les arguments du script arrivent après le séparateur `--`.
    expect(args.indexOf('--input')).toBeGreaterThan(args.indexOf('--'));
    expect(args).toContain('/tmp/scene.usda');
    expect(args).toContain('--purpose');
    expect(args).toContain('render');
  });

  it('transmet la plage de frames et le fps quand ils sont exploitables', () => {
    const args = buildBlenderArgs('/s.py', { ...base, frameStart: 1, frameEnd: 96, fps: 24 });
    expect(args).toContain('--frame-start');
    expect(args[args.indexOf('--frame-end') + 1]).toBe('96');
    expect(args[args.indexOf('--fps') + 1]).toBe('24');
  });

  it('ignore une plage incohérente ou incomplète', () => {
    expect(buildBlenderArgs('/s.py', { ...base, frameStart: 10, frameEnd: 2 })).not.toContain(
      '--frame-start',
    );
    expect(buildBlenderArgs('/s.py', { ...base, frameStart: 1 })).not.toContain('--frame-start');
    expect(buildBlenderArgs('/s.py', { ...base, fps: 0 })).not.toContain('--fps');
  });

  it('permet de forcer une sortie statique', () => {
    expect(buildBlenderArgs('/s.py', { ...base, noAnimation: true })).toContain('--no-animation');
  });

  it('transmet les budgets de cuisson des variantes quand ils sont positifs (46.P)', () => {
    const args = buildBlenderArgs('/s.py', {
      ...base,
      variantLayers: '/tmp/manifest.json',
      variantVertexBudget: 8_000_000,
      variantTimeBudget: 450,
    });
    expect(args[args.indexOf('--variant-layers') + 1]).toBe('/tmp/manifest.json');
    expect(args[args.indexOf('--variant-vertex-budget') + 1]).toBe('8000000');
    expect(args[args.indexOf('--variant-time-budget') + 1]).toBe('450');
    // Sans budget de temps, la cuisson n'est pas bornée artificiellement.
    expect(buildBlenderArgs('/s.py', { ...base, variantTimeBudget: 0 })).not.toContain(
      '--variant-time-budget',
    );
  });
});

describe('parseBlenderSummary', () => {
  it('retrouve le résumé au milieu du bruit de Blender', () => {
    const stdout = [
      'Blender 4.5.0 (hash abc)',
      'Read prefs: /root/.config/blender',
      `${BLENDER_SUMMARY_MARKER} {"objects":12,"meshes":9,"materials":4,"animated":true,"frameStart":1,"frameEnd":96}`,
      'Blender quit',
    ].join('\n');
    const summary = parseBlenderSummary(stdout);
    expect(summary).toMatchObject({ objects: 12, meshes: 9, materials: 4, animated: true });
    expect(summary!.frameEnd).toBe(96);
  });

  it('renvoie null sans marqueur ou avec un JSON cassé', () => {
    expect(parseBlenderSummary('Blender quit')).toBeNull();
    expect(parseBlenderSummary(`${BLENDER_SUMMARY_MARKER} {pas du json}`)).toBeNull();
  });

  it('retient le dernier résumé si le script est appelé plusieurs fois', () => {
    const stdout = `${BLENDER_SUMMARY_MARKER} {"objects":1}\n${BLENDER_SUMMARY_MARKER} {"objects":7}`;
    expect(parseBlenderSummary(stdout)!.objects).toBe(7);
  });
});

describe('summarizeBlenderError', () => {
  it('écarte le bruit et garde les dernières lignes utiles', () => {
    const stderr = [
      'Read prefs: /root/.config',
      'Warning: unsupported schema',
      'RuntimeError: scene USD vide apres import',
    ].join('\n');
    expect(summarizeBlenderError(stderr)).toBe('RuntimeError: scene USD vide apres import');
  });

  it('retombe sur le message par défaut quand tout est du bruit', () => {
    expect(summarizeBlenderError('Warning: rien\nInfo: rien', 'échec Blender')).toBe('échec Blender');
  });

  it('borne la longueur du message remonté', () => {
    expect(summarizeBlenderError('E'.repeat(2000)).length).toBeLessThanOrEqual(500);
  });
});
