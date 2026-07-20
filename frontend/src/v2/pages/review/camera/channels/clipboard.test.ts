import { describe, expect, it } from 'vitest';
import type { CameraAnimV2 } from './model';
import { copyKeys, parseClipboard, pasteKeys } from './clipboard';

const anim: CameraAnimV2 = {
  version: 2,
  loop: true,
  channels: {
    px: {
      keys: [
        { t: 0, v: 1, mode: 'auto' },
        { t: 100, v: 2, mode: 'linear' },
        { t: 300, v: 5, mode: 'free', tin: 0.1, tout: 0.2 },
      ],
    },
    py: { keys: [{ t: 100, v: 9, mode: 'auto' }] },
  },
};

describe('clipboard — copier/coller de clés (40.E)', () => {
  it('copie les clés sélectionnées avec temps relatifs au plus tôt', () => {
    const clip = copyKeys(anim, [
      { channel: 'px', index: 1 },
      { channel: 'px', index: 2 },
      { channel: 'py', index: 0 },
    ]);
    expect(clip).not.toBeNull();
    // min t sélectionné = 100 → rebase à 0.
    expect(clip!.channels.px).toEqual([
      { t: 0, v: 2, mode: 'linear' },
      { t: 200, v: 5, mode: 'free', tin: 0.1, tout: 0.2 },
    ]);
    expect(clip!.channels.py).toEqual([{ t: 0, v: 9, mode: 'auto' }]);
  });

  it('retourne null si la sélection ne référence aucune clé', () => {
    expect(copyKeys(anim, [])).toBeNull();
    expect(copyKeys(anim, [{ channel: 'pz', index: 0 }])).toBeNull();
  });

  it('colle à la tête de lecture en préservant mode/tangentes et sélectionne les clés collées', () => {
    const clip = copyKeys(anim, [
      { channel: 'px', index: 1 },
      { channel: 'px', index: 2 },
      { channel: 'py', index: 0 },
    ])!;
    const { anim: next, selection } = pasteKeys(anim, clip, 500);
    const px = next.channels.px!.keys;
    // Originales [0,100,300] + collées [500,700].
    expect(px.map((k) => k.t)).toEqual([0, 100, 300, 500, 700]);
    expect(px[3]).toEqual({ t: 500, v: 2, mode: 'linear' });
    expect(px[4]).toEqual({ t: 700, v: 5, mode: 'free', tin: 0.1, tout: 0.2 });
    expect(next.channels.py!.keys.map((k) => k.t)).toEqual([100, 500]);
    expect(selection).toEqual([
      { channel: 'px', index: 3 },
      { channel: 'px', index: 4 },
      { channel: 'py', index: 1 },
    ]);
  });

  it('écrase une clé existante au même temps sans doublon', () => {
    const clip = copyKeys(anim, [{ channel: 'px', index: 1 }])!; // une clé, t relatif 0
    const { anim: next } = pasteKeys(anim, clip, 300); // t 300 existe déjà sur px
    const px = next.channels.px!.keys;
    expect(px.map((k) => k.t)).toEqual([0, 100, 300]);
    expect(px[2].v).toBe(2); // remplacée par la clé collée
  });

  it('valide/rejette une forme persistée (round-trip JSON)', () => {
    const clip = copyKeys(anim, [{ channel: 'px', index: 2 }])!;
    const roundTripped = parseClipboard(JSON.parse(JSON.stringify(clip)));
    expect(roundTripped).toEqual(clip);
    expect(parseClipboard(null)).toBeNull();
    expect(parseClipboard({ channels: {} })).toBeNull();
    expect(parseClipboard({ channels: { px: [{ t: 'x', v: 1, mode: 'auto' }] } })).toBeNull();
  });
});
