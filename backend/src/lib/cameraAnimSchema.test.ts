// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { cameraAnimShape, channelSchema, curveKeySchema } from './cameraAnimSchema';

/** Le schéma tel que l'emploie la présentation persistée : au moins une clé, 256 au plus. */
const presentationAnim = z.object(
  cameraAnimShape(channelSchema(curveKeySchema({ minTime: 0, maxTime: 3_600_000 }), { min: 1, max: 2 })),
);

const anim = (keys: unknown[], extra: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  version: 2,
  loop: true,
  channels: { px: { keys, ...extra } },
  ...over,
});

describe('cameraAnimSchema', () => {
  it('accepte une clé de la forme d’origine (mode unifié seul)', () => {
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 1, mode: 'auto' }])).success).toBe(true);
  });

  it('conserve les côtés de tangente, la brisure et les poids', () => {
    const key = {
      t: 500,
      v: -2,
      mode: 'free',
      modeIn: 'flat',
      modeOut: 'free',
      broken: true,
      tin: 0,
      tout: 0.5,
      wIn: 1,
      wOut: 1.25,
    };
    const parsed = presentationAnim.parse(anim([key]));
    // Sans ces champs au schéma, Zod les retirait en silence et la courbe changeait de forme
    // d'un rechargement à l'autre.
    expect(parsed.channels.px?.keys[0]).toEqual(key);
  });

  it('conserve l’extrapolation du canal', () => {
    const parsed = presentationAnim.parse(
      anim([{ t: 0, v: 0, mode: 'auto' }], { pre: 'cycle', post: 'cycleOffset' }),
    );
    expect(parsed.channels.px?.pre).toBe('cycle');
    expect(parsed.channels.px?.post).toBe('cycleOffset');
  });

  it('refuse un profil, une extrapolation ou un poids hors domaine', () => {
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'nope' }])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'auto', modeOut: 'wobble' }])).success).toBe(
      false,
    );
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'auto', wOut: 12 }])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'auto' }], { post: 'spiral' })).success).toBe(
      false,
    );
  });

  it('accepte une animation avec et sans base, et garde la base entière', () => {
    // Sans base : la forme d'avant la Phase 50 lot 13 reste servable telle quelle.
    const sans = presentationAnim.parse(anim([{ t: 0, v: 1, mode: 'auto' }]));
    expect(sans.base).toBeUndefined();
    // Avec base : omise du schéma, `z.object` la retirerait en silence et la caméra du spectateur
    // suivant retomberait sur l'origine du monde — canaux non clés sans repli.
    const base = {
      position: { x: 9, y: 3, z: 4 },
      target: { x: 1, y: 0.5, z: -2 },
      fov: 50,
      roll: 0.25,
    };
    const avec = presentationAnim.parse(anim([{ t: 0, v: 1, mode: 'auto' }], {}, { base }));
    expect(avec.base).toEqual(base);
  });

  it('refuse une base amputée ou hors domaine', () => {
    const ok = { position: { x: 0, y: 0, z: 0 }, target: { x: 1, y: 1, z: 1 } };
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 1, mode: 'auto' }], {}, { base: ok })).success).toBe(
      true,
    );
    for (const base of [
      { position: { x: 0, y: 0 }, target: { x: 1, y: 1, z: 1 } },
      { target: { x: 1, y: 1, z: 1 } },
      { ...ok, fov: 400 },
      { ...ok, roll: 12 },
    ]) {
      expect(presentationAnim.safeParse(anim([{ t: 0, v: 1, mode: 'auto' }], {}, { base })).success).toBe(
        false,
      );
    }
  });

  it('tient les bornes de volume et de temps de son appelant', () => {
    const key = { t: 0, v: 0, mode: 'auto' as const };
    expect(presentationAnim.safeParse(anim([])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([key, key, key])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([{ ...key, t: -1 }])).success).toBe(false);
  });
});
