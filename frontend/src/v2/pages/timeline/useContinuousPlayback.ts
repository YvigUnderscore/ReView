// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../../../lib/apiClient';
import { clipIndexAt, globalTimeOf, localTimeAt, nextPlayableIndex } from './timelinePlayback';
import type { TimelineClip } from '../../types/api';

/**
 * Lecture continue d'un montage, sans coupure (Phase 46).
 *
 * Le principe est celui d'un projectionniste à deux bobines : pendant qu'un plan joue, le
 * suivant est déjà chargé et prêt dans un second lecteur, hors écran. À la fin du plan, on
 * échange les deux — la bascule est un changement de visibilité, pas un chargement, donc
 * l'œil ne voit rien passer. Charger la source au moment de la bascule, comme le ferait
 * une navigation, laisserait à chaque plan le temps noir du téléchargement.
 *
 * Les cartons (plans sans média publié) tiennent leur durée sur une horloge, sans vidéo :
 * ils font partie du montage et ne doivent pas être escamotés.
 */

/** Un tampon de lecture : l'élément vidéo et le plan qu'il tient prêt. */
interface Buffer {
  clipIndex: number | null;
  url: string | null;
}

const EMPTY: Buffer = { clipIndex: null, url: null };

/** URL de lecture d'un média : le proxy web de préférence, la source à défaut. */
async function playbackUrl(mediaId: number): Promise<string | null> {
  const data = await api.get<{ url: string; proxyUrl: string | null }>(`/api/media/${mediaId}`);
  return data.proxyUrl ?? data.url ?? null;
}

export interface ContinuousPlayback {
  /** Tampon actuellement à l'écran. */
  active: 'A' | 'B';
  /** Plan à l'écran, et sa position dans la liste. */
  index: number;
  clip: TimelineClip | null;
  /** Position dans le montage entier, en secondes. */
  time: number;
  playing: boolean;
  toggle: () => void;
  /** Arrêt franc — commenter ou annoter une image suppose qu'elle ne bouge plus. */
  pause: () => void;
  seek: (globalTime: number) => void;
  /** Se placer sur un plan précis (clic dans la bande de vignettes). */
  goToClip: (index: number) => void;
}

/**
 * Les deux éléments vidéo appartiennent au composant, qui les pose sur son JSX : un hook
 * qui renverrait ses propres refs obligerait l'appelant à les lire pendant le rendu.
 *
 * `startAt` est la position du montage à laquelle on entre. La lecture démarre seule :
 * ce hook n'est monté qu'après un geste explicite (bouton de lecture, clic sur la bande),
 * et redemander « lire » à ce moment-là ferait un aller-retour de plus pour rien.
 */
export function useContinuousPlayback(
  items: TimelineClip[],
  videoA: RefObject<HTMLVideoElement | null>,
  videoB: RefObject<HTMLVideoElement | null>,
  startAt = 0,
): ContinuousPlayback {
  const [active, setActive] = useState<'A' | 'B'>('A');
  // Ce que tiennent les deux lecteurs relève de l'état du LECTEUR, pas de celui de
  // l'interface : rien à l'écran n'en dépend directement. Le garder hors du rendu évite
  // autant de rendus inutiles qu'il y a de préchargements.
  const buffers = useRef<{ A: Buffer; B: Buffer }>({ A: EMPTY, B: EMPTY });
  const [index, setIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // La durée écoulée d'un carton est comptée ici : il n'a pas d'élément vidéo pour le faire.
  const placeholderStart = useRef<number | null>(null);
  // …doublée d'un minuteur, pour la même raison que l'écouteur `timeupdate` des vidéos :
  // hors de l'onglet actif, l'horloge d'animation est gelée et le montage resterait
  // indéfiniment sur un trou.
  const placeholderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clip = items[index] ?? null;
  const other = (slot: 'A' | 'B'): 'A' | 'B' => (slot === 'A' ? 'B' : 'A');
  // L'élément d'un tampon n'est lu que dans les callbacks et les effets, jamais pendant le
  // rendu : c'est la condition pour que React garantisse ce qu'on y voit.
  const elementOf = useCallback(
    (slot: 'A' | 'B') => (slot === 'A' ? videoA.current : videoB.current),
    [videoA, videoB],
  );

  /** Charge un plan dans un tampon et renvoie l'élément prêt à jouer. */
  const load = useCallback(
    async (slot: 'A' | 'B', clipIndex: number, startAt = 0) => {
      const target = items[clipIndex];
      // Un carton n'a pas de source à résoudre, mais la préparation d'un tampon reste
      // asynchrone dans tous les cas : sans cela, l'amorçage déclencherait un rendu en
      // cascade depuis son effet.
      const url = await (target?.mediaId != null ? playbackUrl(target.mediaId) : Promise.resolve(null));
      buffers.current = { ...buffers.current, [slot]: { clipIndex, url } };
      const el = elementOf(slot);
      if (el && url) {
        el.src = url;
        el.currentTime = startAt;
        // `auto` : on veut la vidéo entière en tampon, pas seulement ses métadonnées —
        // c'est ce préchargement qui rend la bascule invisible.
        el.preload = 'auto';
        el.load();
      }
    },
    [items, elementOf],
  );

  /** Prépare le plan lisible suivant dans le tampon inactif. */
  const preloadNext = useCallback(
    (fromIndex: number, activeSlot: 'A' | 'B') => {
      const next = nextPlayableIndex(items, fromIndex);
      if (next < 0) return;
      void load(other(activeSlot), next);
    },
    [items, load],
  );

  const clearPlaceholderTimer = useCallback(() => {
    if (placeholderTimer.current !== null) clearTimeout(placeholderTimer.current);
    placeholderTimer.current = null;
  }, []);

  // `swap` s'arme lui-même à travers cette référence : la fonction et son minuteur
  // s'appellent mutuellement, et seule une indirection casse le cycle de déclaration.
  const swapRef = useRef<() => void>(() => {});

  /** Programme la sortie d'un carton au bout de sa durée. */
  const armPlaceholderTimer = useCallback(
    (duration: number) => {
      clearPlaceholderTimer();
      placeholderTimer.current = setTimeout(() => swapRef.current(), Math.max(0, duration * 1000));
    },
    [clearPlaceholderTimer],
  );

  /**
   * Lance la lecture à une position donnée d'un plan, quelle que soit sa nature.
   *
   * Un carton n'a pas d'élément vidéo à démarrer : c'est son minuteur qui tient sa durée.
   * Passer par ce seul point d'entrée évite que l'un des trois chemins qui démarrent la
   * lecture (amorçage, pause/reprise, déplacement) n'oublie ce cas.
   */
  const begin = useCallback(
    (slot: 'A' | 'B', targetIndex: number, localStart: number) => {
      const target = items[targetIndex];
      if (!target) return;
      setPlaying(true);
      if (target.mediaId === null) {
        placeholderStart.current = performance.now() - localStart * 1000;
        armPlaceholderTimer(target.duration - localStart);
        return;
      }
      placeholderStart.current = null;
      clearPlaceholderTimer();
      void elementOf(slot)
        ?.play()
        .catch(() => setPlaying(false));
    },
    [items, elementOf, armPlaceholderTimer, clearPlaceholderTimer],
  );

  /**
   * Passe au plan suivant du montage.
   *
   * « Suivant » veut dire le plan d'après dans la liste, carton compris : un trou occupe sa
   * place à l'écran pendant sa durée, sinon le film ne dure pas ce que la barre de temps
   * annonce et l'on ne voit plus ce qui manque. Le préchargement, lui, vise le prochain
   * plan FILMÉ — pendant qu'un carton s'affiche, la vidéo d'après finit de se charger.
   */
  const swap = useCallback(() => {
    const nextIndex = index + 1;
    const next = items[nextIndex];
    if (!next) {
      setPlaying(false);
      return;
    }
    setIndex(nextIndex);
    setTime(next.startTime);

    if (next.mediaId === null) {
      elementOf(active)?.pause();
      placeholderStart.current = performance.now();
      armPlaceholderTimer(next.duration);
      preloadNext(nextIndex, active);
      return;
    }

    const nextSlot = other(active);
    const prepared = buffers.current[nextSlot];
    placeholderStart.current = null;
    clearPlaceholderTimer();
    // Cas normal : le plan attendait déjà dans l'autre tampon, la bascule est instantanée.
    if (prepared.clipIndex === nextIndex && prepared.url) {
      // Le tampon sortant est arrêté : invisible, il continuerait sinon à jouer son
      // audio et à consommer du décodage derrière le plan suivant.
      elementOf(active)?.pause();
      setActive(nextSlot);
      void elementOf(nextSlot)
        ?.play()
        .catch(() => setPlaying(false));
      preloadNext(nextIndex, nextSlot);
      return;
    }
    // Cas de repli (déplacement manuel juste avant la fin d'un plan) : on charge sur place.
    void load(active, nextIndex).then(() => {
      void elementOf(active)
        ?.play()
        .catch(() => setPlaying(false));
      preloadNext(nextIndex, active);
    });
  }, [active, index, items, preloadNext, elementOf, load, armPlaceholderTimer, clearPlaceholderTimer]);

  // Le minuteur des cartons appelle toujours la version courante de `swap`.
  useEffect(() => {
    swapRef.current = swap;
  }, [swap]);

  // Un montage quitté en cours de carton ne doit pas laisser de minuteur derrière lui.
  useEffect(() => clearPlaceholderTimer, [clearPlaceholderTimer]);

  // Amorçage, en deux temps. La position de départ est un ajustement d'état PENDANT le
  // rendu (motif React admis) : les plans arrivent d'une requête, l'état initial ne peut
  // donc pas être calculé au premier rendu. Le chargement, lui, est un effet de bord et
  // reste dans un effet.
  const [started, setStarted] = useState(false);
  if (!started && items.length > 0) {
    // On entre là où l'on a cliqué, carton compris : escamoter un trou de départ ferait
    // commencer le film ailleurs que là où la bande le montrait.
    const first = Math.max(0, clipIndexAt(items, startAt));
    setStarted(true);
    setIndex(first);
    setTime(globalTimeOf(items[first]!, startAt - items[first]!.startTime));
  }

  // Le chargement du premier plan est asynchrone : sans ce verrou, un rendu survenu avant
  // sa résolution relancerait l'amorçage et ferait jouer deux fois le même plan.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!started || bootstrapped.current) return;
    const target = items[index];
    if (!target) return;
    bootstrapped.current = true;
    const local = localTimeAt(target, startAt);
    void load('A', index, local).then(() => {
      preloadNext(index, 'A');
      begin('A', index, local);
    });
  }, [started, index, items, startAt, load, preloadNext, begin]);

  // Horloge : la vidéo pour un plan filmé, `performance.now()` pour un carton.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const current = items[index];
      // C'est le PLAN courant qui dit quelle horloge suivre, jamais le tampon : le tampon
      // sortant garde sa source pendant un carton, et s'y fier ferait comparer la position
      // du plan précédent à la durée du trou — donc escamoter le trou aussitôt affiché.
      if (current && current.mediaId === null) {
        if (placeholderStart.current !== null) {
          const elapsed = (performance.now() - placeholderStart.current) / 1000;
          setTime(globalTimeOf(current, elapsed));
          if (elapsed >= current.duration) swap();
        }
      } else if (current) {
        const el = elementOf(active);
        if (buffers.current[active].url && el) {
          // La durée qui fait foi est celle du MONTAGE, pas celle du fichier. Un média plus
          // long que la place qu'on lui a donnée est coupé ici : sans cela la barre de temps
          // mentirait, et un seul plan mal sondé décalerait tout le film.
          if (el.currentTime >= current.duration) swap();
          else setTime(globalTimeOf(current, el.currentTime));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, index, active, items, swap, elementOf]);

  // Fin d'un plan filmé : on enchaîne sur le tampon déjà prêt.
  useEffect(() => {
    const el = elementOf(active);
    if (!el) return;
    const onEnded = () => swap();
    /*
     * Filet de sécurité pour la coupe à la durée du montage. Le navigateur gèle
     * `requestAnimationFrame` dès que l'onglet passe en arrière-plan, alors qu'il continue
     * de jouer la vidéo : sans cet écouteur, un plan resté en fond déborderait sur toute la
     * longueur de son fichier et décalerait le reste du film. `timeupdate` est émis dans
     * tous les cas.
     */
    const onTimeUpdate = () => {
      const current = items[index];
      // Même règle que l'horloge : pendant un carton, cet élément n'est plus le film.
      if (current && current.mediaId !== null && el.currentTime >= current.duration) swap();
    };
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [active, swap, elementOf, items, index]);

  const pause = useCallback(() => {
    elementOf(active)?.pause();
    placeholderStart.current = null;
    clearPlaceholderTimer();
    setPlaying(false);
  }, [active, elementOf, clearPlaceholderTimer]);

  const toggle = useCallback(() => {
    if (playing) {
      pause();
      return;
    }
    // Reprise là où l'on s'était arrêté, y compris au milieu d'un carton.
    begin(active, index, time - (clip?.startTime ?? 0));
  }, [active, index, playing, time, clip, begin, pause]);

  const goTo = useCallback(
    (targetIndex: number, localStart: number) => {
      const target = items[targetIndex];
      if (!target) return;
      setIndex(targetIndex);
      setTime(globalTimeOf(target, localStart));
      placeholderStart.current = null;
      clearPlaceholderTimer();
      // Le plan visé prend le tampon actif : le tampon inactif reprendra le suivant.
      void load(active, targetIndex, localStart).then(() => {
        if (playing) begin(active, targetIndex, localStart);
        preloadNext(targetIndex, active);
      });
    },
    [items, active, load, preloadNext, playing, begin, clearPlaceholderTimer],
  );

  const seek = useCallback(
    (globalTime: number) => {
      const targetIndex = clipIndexAt(items, globalTime);
      if (targetIndex < 0) return;
      const target = items[targetIndex]!;
      const local = localTimeAt(target, globalTime);
      // Déplacement à l'intérieur du plan courant : un simple `currentTime` suffit, inutile
      // de recharger la source.
      if (targetIndex === index && buffers.current[active].url) {
        const el = elementOf(active);
        if (el) el.currentTime = local;
        setTime(globalTime);
        return;
      }
      goTo(targetIndex, local);
    },
    [items, index, active, goTo, elementOf],
  );

  return {
    active,
    index,
    clip,
    time,
    playing,
    toggle,
    pause,
    seek,
    goToClip: (i: number) => goTo(i, 0),
  };
}
