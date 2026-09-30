// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type RefObject } from 'react';

/**
 * Tient l'état « ça joue » sur les événements des éléments, jamais sur la promesse de `play()`.
 *
 * `play()` rend une promesse que la politique d'autoplay rejette tant qu'aucun geste n'a eu
 * lieu : on posait alors `playing = false`. Mais le navigateur démarre la lecture dès le
 * premier geste, sans repasser par nous. L'élément jouait donc pendant que l'horloge du
 * montage restait figée — le compteur ne bougeait plus, et le plan suivant n'arrivait jamais.
 * Les événements `play` / `pause` de l'élément sont la seule source qui ne mente pas.
 *
 * Les deux lecteurs sont écoutés : celui qui sort est mis en pause à chaque bascule, et c'est
 * l'entrant qui doit alors faire foi.
 */
export function usePlayingFromElements(
  videoA: RefObject<HTMLVideoElement | null>,
  videoB: RefObject<HTMLVideoElement | null>,
  setPlaying: (playing: boolean) => void,
): void {
  useEffect(() => {
    const a = videoA.current;
    const b = videoB.current;
    const elements = [a, b].filter((el): el is HTMLVideoElement => el !== null);
    const onPlay = () => setPlaying(true);
    // Une pause ne compte que si PLUS AUCUN lecteur ne joue : le tampon sortant est mis en
    // pause au moment même où l'entrant démarre.
    const onPause = () => setPlaying(elements.some((el) => !el.paused));
    for (const el of elements) {
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
    }
    return () => {
      for (const el of elements) {
        el.removeEventListener('play', onPlay);
        el.removeEventListener('pause', onPause);
      }
    };
  }, [videoA, videoB, setPlaying]);
}
