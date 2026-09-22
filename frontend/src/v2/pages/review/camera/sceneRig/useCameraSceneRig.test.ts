// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { emptyAnim, upsertKey } from '../channels/model';
import { strokeTime } from './useCameraSceneRig';

/**
 * Le temps d'écriture d'un geste de gizmo. Ce qu'il faut verrouiller ici est la raison du retour
 * visuel : dès que ce temps s'écarte de la tête de lecture, la scène montre autre chose que ce que
 * le geste modifie — le rig y amène donc la tête (cf. `onDragging`).
 */

const anim = upsertKey(upsertKey(emptyAnim(), 'px', 0, 1), 'px', 2000, 5);

describe('strokeTime — où écrit un geste de gizmo', () => {
  it('sans sélection : à la tête de lecture, arrondie', () => {
    expect(strokeTime({ selection: [], anim, timeMs: 1234.6 })).toBe(1235);
  });

  it('avec une clé reprise : au temps de cette clé, pas à la tête de lecture', () => {
    const t = strokeTime({ selection: [{ channel: 'px', index: 0 }], anim, timeMs: 1800 });
    expect(t).toBe(0);
    expect(t).not.toBe(1800); // c'est cet écart qui rendait le geste invisible
  });

  it('clé « primaire » = la dernière de la multi-sélection', () => {
    const selection = [
      { channel: 'px' as const, index: 1 },
      { channel: 'px' as const, index: 0 },
    ];
    expect(strokeTime({ selection, anim, timeMs: 900 })).toBe(0);
  });

  it('sélection devenue obsolète (clé supprimée) : retombe sur la tête de lecture', () => {
    expect(strokeTime({ selection: [{ channel: 'py', index: 3 }], anim, timeMs: 700 })).toBe(700);
  });

  it('jamais de temps négatif', () => {
    expect(strokeTime({ selection: [], anim, timeMs: -50 })).toBe(0);
  });
});
