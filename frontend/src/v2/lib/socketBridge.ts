// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getSocket } from '../../lib/socket';
import { qk } from './query';

/** Payloads des événements temps réel émis par les routes backend (10.E3). */
interface TaskEvent {
  projectId: number;
  id: number;
  shotId: number | null;
  assetId: number | null;
}
interface VersionEvent {
  projectId: number;
  id: number;
  taskId: number | null;
  assetId: number | null;
}
interface MediaEvent {
  projectId: number;
  id: number;
  versionId: number;
}
/**
 * Plan, séquence ou asset : le serveur n'émet que le couple projet/identifiant.
 *
 * `ids` est le volet « lot » : une action de production sur trente plans émet UN
 * événement qui les porte tous, au lieu de trente événements unitaires. `id` y reste
 * renseigné (premier du lot) pour les consommateurs qui ne lisent pas `ids`.
 */
interface EntityEvent {
  projectId: number;
  id: number;
  ids?: number[];
}

const COMMENT_EVENTS = [
  'comment:new',
  'comment:update',
  'comment:delete',
  'comment:reaction',
  'comment:reaction:remove',
];

/**
 * Fenêtre de regroupement des invalidations (ms).
 *
 * C'est le délai MAXIMAL entre un changement distant et son affichage, pas un délai
 * systématique : la première invalidation d'une rafale part au plus tôt (cf. `add`).
 * Deux dixièmes de seconde ne se voient pas à l'œil ; les allonger donnerait une
 * interface qui « ne bouge plus », ce qui serait pire que le problème traité.
 */
export const COALESCE_WINDOW_MS = 200;

/**
 * Au-delà de ce nombre d'entités dans un lot, on invalide le préfixe d'entité plutôt
 * qu'une clé par identifiant : parcourir mille fois le cache pour mille fiches dont une
 * seule est à l'écran coûte plus cher que le rafraîchissement qu'on cherche à éviter.
 */
const MAX_BATCH_KEYS = 50;

type QueryKey = readonly unknown[];

/** `a` est-il un préfixe de `b` ? (les invalidations Query matchent par préfixe) */
function isPrefix(a: QueryKey, b: QueryKey): boolean {
  return a.length <= b.length && a.every((part, i) => Object.is(part, b[i]));
}

/**
 * Retire d'une fournée les clés qu'une autre clé de la même fournée invalide déjà.
 *
 * `invalidateQueries` matche par préfixe : invalider `['shot', 7]` puis `['shot', 7,
 * 'tree']` touchait deux fois la requête d'arbre — et comme `invalidateQueries` annule
 * par défaut la requête en vol pour en relancer une, la seconde jetait la réponse de la
 * première. Une requête HTTP sur deux, sur la fiche d'un plan, était abandonnée.
 *
 * Les clés reçues sont uniques (dédoublonnées par leur forme sérialisée en amont) :
 * deux entrées de contenu identique ne peuvent donc pas s'éliminer mutuellement.
 */
export function dropRedundantKeys(keys: QueryKey[]): QueryKey[] {
  return keys.filter((key) => !keys.some((other) => other !== key && isPrefix(other, key)));
}

interface InvalidationQueue {
  add(key: QueryKey): void;
  dispose(): void;
}

/**
 * File d'invalidations coalescée.
 *
 * Un lot de statuts sur trente plans émettait trente `shot:update`, et chacun rechargeait
 * le kanban entier — la lecture la plus lourde de l'application — chez chaque personne
 * qui l'avait ouvert. Les vingt-neuf premières réponses étaient jetées : `invalidateQueries`
 * annule la requête en vol avant d'en relancer une.
 *
 * Le regroupement est un « throttle à front montant », pas un debounce : la première
 * invalidation part tout de suite (à un tour de boucle près, le temps que toutes les clés
 * d'un même événement rejoignent la fournée), les suivantes sont retenues au plus
 * `COALESCE_WINDOW_MS`. Un debounce simple, lui, aurait repoussé l'affichage jusqu'à la
 * fin de la rafale : sur un lot qui met trois secondes à s'écrire côté serveur, l'écran
 * serait resté figé tout du long.
 */
function createInvalidationQueue(qc: QueryClient): InvalidationQueue {
  const pending = new Map<string, QueryKey>();
  let lead: ReturnType<typeof setTimeout> | null = null;
  let guard: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    lead = null;
    const keys = dropRedundantKeys([...pending.values()]);
    pending.clear();
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    // Fenêtre de garde : ce qui arrive maintenant attend ici plutôt que de relancer
    // aussitôt les mêmes requêtes. Elle se referme d'elle-même si rien ne vient.
    guard = setTimeout(() => {
      guard = null;
      if (pending.size > 0) flush();
    }, COALESCE_WINDOW_MS);
  };

  return {
    add(key: QueryKey): void {
      pending.set(JSON.stringify(key), key);
      // Une fournée est déjà programmée, ou la fenêtre court : elle emportera cette clé.
      if (lead || guard) return;
      // Délai nul plutôt qu'appel direct : les quatre ou cinq clés d'un même événement
      // rejoignent ainsi la même fournée, et se dédoublonnent entre elles.
      lead = setTimeout(flush, 0);
    },
    dispose(): void {
      if (lead) clearTimeout(lead);
      if (guard) clearTimeout(guard);
      lead = null;
      guard = null;
      pending.clear();
    },
  };
}

/** Identifiants portés par un événement d'entité : le lot s'il existe, sinon l'unité. */
const entityIds = (e: EntityEvent): number[] => (e.ids?.length ? e.ids : [e.id]);

/**
 * Pont temps réel → cache Query (10.E3) : rejoint la room du projet courant
 * (RBAC revérifié côté serveur à chaque join) et traduit chaque événement
 * socket en invalidations ciblées. Une invalidation ne re-fetch que les
 * queries actuellement montées : coût nul pour les écrans non concernés.
 */
export function useSocketInvalidation(projectId: number | null): void {
  const qc = useQueryClient();

  // Rejoint la room du projet courant ; re-join après une reconnexion socket.
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();
    const join = () => socket.emit('join_project', projectId);
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      // On quitte la salle en partant (D3) : sans cela, un onglet ouvert toute la journée
      // reçoit les événements de tous les projets visités depuis le matin.
      socket.emit('leave_project', projectId);
    };
  }, [projectId]);

  useEffect(() => {
    const socket = getSocket();
    const q = createInvalidationQueue(qc);
    // Les payloads commentaire n'exposent pas toujours le mediaObjectId (delete,
    // réactions) : invalidation par préfixe — seule la review montée re-fetch.
    const onComment = () => {
      q.add(['comments']);
    };
    const onTask = (e: TaskEvent) => {
      if (e.shotId != null) q.add(qk.tasks(e.shotId));
      q.add(qk.task(e.id));
      q.add(qk.projectActivity(e.projectId));
    };
    const onVersion = (e: VersionEvent) => {
      const parent =
        e.taskId != null ? `taskId=${e.taskId}` : e.assetId != null ? `assetId=${e.assetId}` : null;
      if (parent) q.add(qk.versions(parent));
      q.add(qk.version(e.id));
      q.add(qk.projectActivity(e.projectId));
      q.add(['asset']);
      q.add(['timeline']);
    };
    const onMedia = (e: MediaEvent) => {
      // Ne jamais invalider qk.media(id) : URLs présignées en staleTime Infinity
      // (10.E1) — un refetch rechargerait le viewer en pleine lecture.
      q.add(qk.version(e.versionId));
      q.add(['versions']);
      q.add(qk.projectActivity(e.projectId));
      // Publier un média fait avancer l'asset et le montage : c'est tout l'intérêt de
      // l'auto-timeline (Phase 45), elle doit se remettre à jour sans rechargement.
      q.add(['asset']);
      q.add(['timeline']);
    };
    const onTimeline = () => {
      q.add(['timeline']);
    };
    /**
     * Plans, séquences et assets — le serveur émettait déjà ces trois événements et
     * personne ne les écoutait : un statut changé ailleurs (par un collègue, ou lu depuis
     * ShotGrid) n'atteignait jamais un écran ouvert. Il fallait recharger la page pour le
     * voir, ce qui donnait l'impression que le changement n'était pas passé.
     *
     * `qk.shotTree`/`qk.assetTree` ne sont plus cités : `qk.shot`/`qk.asset` en sont le
     * préfixe et les invalident déjà (cf. `dropRedundantKeys`).
     */
    const onShot = (e: EntityEvent) => {
      const ids = entityIds(e);
      if (ids.length > MAX_BATCH_KEYS) q.add(['shot']);
      else for (const id of ids) q.add(qk.shot(id));
      q.add(qk.shots(e.projectId));
      q.add(qk.projectBoard(e.projectId));
      q.add(qk.projectActivity(e.projectId));
    };
    const onSequence = (e: EntityEvent) => {
      const ids = entityIds(e);
      if (ids.length > MAX_BATCH_KEYS) q.add(['sequence']);
      else for (const id of ids) q.add(qk.sequence(id));
      q.add(qk.sequences(e.projectId));
      q.add(qk.projectActivity(e.projectId));
    };
    const onAsset = (e: EntityEvent) => {
      const ids = entityIds(e);
      if (ids.length > MAX_BATCH_KEYS) q.add(['asset']);
      else for (const id of ids) q.add(qk.asset(id));
      q.add(qk.assets(e.projectId));
      q.add(qk.projectActivity(e.projectId));
    };
    COMMENT_EVENTS.forEach((ev) => socket.on(ev, onComment));
    socket.on('task:update', onTask);
    socket.on('version:update', onVersion);
    socket.on('media:update', onMedia);
    socket.on('timeline:update', onTimeline);
    socket.on('shot:update', onShot);
    socket.on('sequence:update', onSequence);
    socket.on('asset:update', onAsset);
    return () => {
      COMMENT_EVENTS.forEach((ev) => socket.off(ev, onComment));
      socket.off('task:update', onTask);
      socket.off('version:update', onVersion);
      socket.off('media:update', onMedia);
      socket.off('timeline:update', onTimeline);
      socket.off('shot:update', onShot);
      socket.off('sequence:update', onSequence);
      socket.off('asset:update', onAsset);
      q.dispose();
    };
  }, [qc]);
}
