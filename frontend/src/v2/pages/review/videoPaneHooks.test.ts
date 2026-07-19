import { describe, expect, it } from 'vitest';
import { shouldLoopBack } from './videoPaneHooks';

describe('shouldLoopBack — rebouclage I/O (retours 34)', () => {
  it('reboucle en lecture quand la boucle est active et que O est atteint', () => {
    expect(shouldLoopBack(1, 3, true, false, 3)).toBe(true);
    expect(shouldLoopBack(1, 3, true, false, 4.5)).toBe(true);
  });

  it('ne reboucle pas avant le point O', () => {
    expect(shouldLoopBack(1, 3, true, false, 2.9)).toBe(false);
  });

  it('ne reboucle jamais en pause : la navigation manuelle dépasse librement O', () => {
    expect(shouldLoopBack(1, 3, true, true, 3.5)).toBe(false);
  });

  it('ne reboucle pas quand la boucle est désactivée (les points I/O restent posés)', () => {
    expect(shouldLoopBack(1, 3, false, false, 3.5)).toBe(false);
  });

  it('ignore les boucles incomplètes ou inversées', () => {
    expect(shouldLoopBack(null, 3, true, false, 3.5)).toBe(false);
    expect(shouldLoopBack(1, null, true, false, 3.5)).toBe(false);
    expect(shouldLoopBack(3, 1, true, false, 3.5)).toBe(false);
  });
});
