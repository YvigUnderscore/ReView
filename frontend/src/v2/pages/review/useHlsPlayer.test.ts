// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useHlsPlayer } from './useHlsPlayer';

/**
 * Deux propriétés sont vérifiées ici, et la première est une **grandeur** : le nombre de
 * fois où le module `hls.js` est évalué. Avec l'import statique d'avant, il valait 1 dès
 * l'import du hook — donc pour une review d'image, de 3D ou de splat. Il doit valoir 0
 * tant qu'aucune playlist n'est jouée, puis 1 quelle que soit la suite.
 *
 * La seconde est le contrat d'écran : `active` (donc « l'élément vidéo reçoit-il `src` ? »)
 * doit être connu **dès le premier rendu**, sans attendre le téléchargement — sinon le
 * lecteur afficherait un MP4 le temps d'un aller-retour avant de basculer.
 */

const lib = vi.hoisted(() => ({
  /** Nombre d'évaluations du module `hls.js` = nombre de téléchargements du lecteur. */
  loads: 0,
  /** Nombre de lecteurs instanciés. */
  created: 0,
  last: null as FakePlayer | null,
}));

interface FakePlayer {
  config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void };
  media: HTMLVideoElement | null;
  src: string | null;
  levels: { height: number; bitrate: number }[];
  currentLevel: number;
  nextLevel: number;
  destroyed: boolean;
  on(evt: string, cb: (evt: string, data?: unknown) => void): void;
  emit(evt: string, data?: unknown): void;
  destroy(): void;
}

vi.mock('hls.js', () => {
  lib.loads += 1;
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'manifestParsed', LEVEL_SWITCHED: 'levelSwitched', ERROR: 'error' };
    media: HTMLVideoElement | null = null;
    src: string | null = null;
    levels = [
      { height: 540, bitrate: 1_000 },
      { height: 1080, bitrate: 4_000 },
      { height: 720, bitrate: 2_000 },
    ];
    currentLevel = -1;
    nextLevel = -1;
    destroyed = false;
    private handlers = new Map<string, ((evt: string, data?: unknown) => void)[]>();
    constructor(public config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }) {
      lib.created += 1;
      lib.last = this;
    }
    attachMedia(v: HTMLVideoElement) {
      this.media = v;
    }
    loadSource(u: string) {
      this.src = u;
    }
    on(evt: string, cb: (evt: string, data?: unknown) => void) {
      this.handlers.set(evt, [...(this.handlers.get(evt) ?? []), cb]);
    }
    emit(evt: string, data?: unknown) {
      (this.handlers.get(evt) ?? []).forEach((cb) => cb(evt, data));
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { default: FakeHls };
});

// MSE présent : sans ce bouchon, happy-dom ferait retomber tout le monde sur le repli MP4.
(globalThis as Record<string, unknown>).MediaSource = { isTypeSupported: () => true };

const MASTER = '/api/media/7/hls/master.m3u8';

function mountPlayer(url: string | null) {
  const ref = createRef<HTMLVideoElement | null>() as { current: HTMLVideoElement | null };
  ref.current = document.createElement('video');
  return { ref, ...renderHook(() => useHlsPlayer(ref, url)) };
}

describe('useHlsPlayer — le lecteur adaptatif ne se télécharge que pour une vidéo', () => {
  it('une review sans playlist n’évalue jamais hls.js', async () => {
    expect(lib.loads).toBe(0);
    const image = mountPlayer(null);
    expect(image.result.current.active).toBe(false);
    // Une source MP4 (média transcodé avant l’échelle adaptative, ou trim gravé) non plus.
    const mp4 = mountPlayer('/api/media/7/proxy.mp4');
    expect(mp4.result.current.active).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(lib.loads).toBe(0);
    expect(lib.created).toBe(0);
  });

  it('une playlist le charge — une seule fois pour deux lecteurs (comparaison A/B)', async () => {
    const a = mountPlayer(MASTER);
    // Aucun aller-retour n’est attendu pour savoir quoi afficher : l’élément vidéo sait
    // dès ce rendu-ci qu’il ne doit pas poser `src`.
    expect(a.result.current.active).toBe(true);
    mountPlayer(MASTER);
    await waitFor(() => expect(lib.created).toBe(2));
    expect(lib.loads).toBe(1);
  });

  it('joue toujours : manifeste attaché, meilleure rendition verrouillée', async () => {
    const { ref, result } = mountPlayer(MASTER);
    await waitFor(() => expect(lib.last?.src).toBe(MASTER));
    const player = lib.last!;
    expect(player.media).toBe(ref.current);
    act(() => player.emit('manifestParsed'));
    // 1080 est la plus haute des trois renditions — c’est elle qui doit être verrouillée.
    expect(player.currentLevel).toBe(1);
    expect(result.current.level).toBe(1);
    expect(result.current.levels.map((l) => l.height)).toEqual([540, 1080, 720]);
  });

  it('un démontage pendant le téléchargement n’attache aucun lecteur au DOM retiré', async () => {
    const before = lib.created;
    const { unmount } = mountPlayer(MASTER);
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lib.created).toBe(before);
  });

  it('détruit le lecteur au démontage (aucune instance laissée derrière)', async () => {
    const { unmount } = mountPlayer(MASTER);
    await waitFor(() => expect(lib.created).toBeGreaterThan(0));
    const player = lib.last!;
    unmount();
    expect(player.destroyed).toBe(true);
  });
});
