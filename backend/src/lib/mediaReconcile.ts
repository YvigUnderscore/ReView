// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { mediaQueue } from '../services/JobService';

/**
 * Réconciliation des médias figés en `PROCESSING`.
 *
 * Un worker tué en plein transcodage perd son verrou BullMQ. Le premier calage rejoue le
 * job, mais au second (`maxStalledCount: 1`) BullMQ l'échoue **hors du chemin
 * applicatif** : le média reste `PROCESSING`, sans `processingError`, indiscernable d'un
 * travail en cours. Aucune requête ne balayait cet état — un média perdu ainsi l'était
 * définitivement.
 *
 * Politique retenue : **échec explicite, jamais de remise en file automatique.**
 *  - Le type de job d'origine (`transcode`/`thumbnail`/`convert3d`) n'est pas reconstituable
 *   de façon sûre depuis la base ; le réenfiler à l'aveugle risquerait de lancer le mauvais
 *   travail et d'écraser des dérivés valides.
 *  - Un fichier pathologique qui refait échouer le worker se remettrait en file à chaque
 *   redémarrage, indéfiniment.
 *  - `FAILED` + `processingError` est un état **visible** : la review affiche la raison et
 *   l'action « retraiter » existante réenfile le bon job, sur décision humaine.
 *
 * Deux garde-fous avant de condamner un média : il ne doit exister **aucun job vivant**
 * pour lui dans la file (en attente, actif, différé…), et il doit être ancien — un média
 * tout juste enfilé ne doit pas être rattrapé par un balayage qui court plus vite que lui.
 */

/** Âge minimal avant qu'un média `PROCESSING` sans job vivant soit tenu pour perdu. */
export const MEDIA_STUCK_AFTER_MS = 15 * 60_000;

/** Délai avant le balayage de démarrage : laisse le worker se connecter à la file. */
export const RECONCILE_BOOT_DELAY_MS = 20_000;

export type ReconcileAction = 'skip' | 'fail';

export interface StuckMediaCandidate {
  id: number;
  /** Ancienneté du média (ms). */
  ageMs: number;
  /** Un job le concernant existe encore dans la file (attente, actif, différé, priorisé…). */
  hasLiveJob: boolean;
}

/**
 * Décide du sort d'un média resté en `PROCESSING`. Fonction pure : c'est elle qui porte la
 * politique, et c'est elle qu'on teste.
 */
export function reconcileAction(
  candidate: StuckMediaCandidate,
  stuckAfterMs: number = MEDIA_STUCK_AFTER_MS,
): ReconcileAction {
  if (candidate.hasLiveJob) return 'skip';
  if (candidate.ageMs < stuckAfterMs) return 'skip';
  return 'fail';
}

/** Message porté par `metadata.processingError` — en anglais, comme toutes les erreurs backend. */
export function reconcileFailureMessage(ageMs: number): string {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  return `Processing was interrupted (worker restarted or job lost): the media stayed in PROCESSING for ${minutes} min with no live job. Relaunch processing from the media menu.`;
}

/** États BullMQ qui protègent un média : son traitement n'est pas perdu, il attend son tour. */
const LIVE_JOB_TYPES = ['waiting', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children'] as const;

/**
 * Plafond de jobs relevés par état et par passe.
 *
 * `getJobs` sans plage rapatrie **chaque** job vivant depuis Redis, charge utile comprise.
 * Tant que la réconciliation ne tournait qu'au démarrage de l'API, personne ne le voyait ;
 * périodique, elle traverserait tout l'arriéré à chaque passe d'entretien. La plage la
 * borne. Deux mille par état laisse une marge considérable sur un arriéré de studio (la
 * file média porte un job par média enfilé, pas un par segment).
 */
export const LIVE_JOB_SCAN_MAX = 2_000;

export interface LiveMediaJobs {
  /** Médias ayant encore un job vivant. */
  ids: Set<number>;
  /**
   * Faux dès que le relevé atteint le plafond. BullMQ applique la plage état par état : on
   * ne peut pas distinguer, dans le résultat aplati, un état saturé d'une somme d'états
   * chargés — alors on ne distingue pas, on s'abstient. Croire « aucun job » sur un relevé
   * peut-être partiel condamnerait un média dont le traitement attend simplement son tour,
   * et c'est irrattrapable : le média passe en FAILED sous les yeux de l'artiste.
   */
  complete: boolean;
}

/** Identifiants de médias ayant encore un job vivant dans la file de traitement. */
export async function liveMediaJobIds(): Promise<LiveMediaJobs> {
  // Un seul appel : BullMQ lit les six états dans un même script Lua, donc l'instantané
  // reste cohérent — un job qui passe de `waiting` à `active` ne peut pas se glisser
  // entre deux lectures et disparaître du relevé.
  const jobs = await mediaQueue.getJobs([...LIVE_JOB_TYPES], 0, LIVE_JOB_SCAN_MAX - 1);
  const ids = new Set<number>();
  for (const job of jobs) {
    const id = job?.data?.mediaObjectId;
    if (typeof id === 'number') ids.add(id);
  }
  return { ids, complete: jobs.length < LIVE_JOB_SCAN_MAX };
}

/**
 * Balaye les médias `PROCESSING` et condamne ceux qui n'ont plus de job vivant.
 * Renvoie le nombre de médias passés en échec.
 */
export async function reconcileStuckMedia(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEDIA_STUCK_AFTER_MS);
  const candidates = await prisma.mediaObject.findMany({
    where: { status: MediaStatus.PROCESSING, deletedAt: null, createdAt: { lt: cutoff } },
    select: { id: true, createdAt: true, metadata: true },
  });
  if (candidates.length === 0) return 0;

  const live = await liveMediaJobIds();
  if (!live.complete) {
    logger.warn(
      { scanned: candidates.length, max: LIVE_JOB_SCAN_MAX },
      '[reconcile] relevé des jobs vivants tronqué : passe abandonnée sans condamner de média',
    );
    return 0;
  }
  let failed = 0;
  for (const media of candidates) {
    const ageMs = now.getTime() - media.createdAt.getTime();
    if (reconcileAction({ id: media.id, ageMs, hasLiveJob: live.ids.has(media.id) }) !== 'fail') continue;
    const metadata: Record<string, unknown> = { ...((media.metadata ?? {}) as object) };
    metadata.processingError = reconcileFailureMessage(ageMs);
    // `updateMany` avec le statut en condition : si le worker vient de terminer entre la
    // lecture et l'écriture, on ne rétrograde pas un média devenu READY.
    const res = await prisma.mediaObject.updateMany({
      where: { id: media.id, status: MediaStatus.PROCESSING },
      data: { status: MediaStatus.FAILED, metadata: metadata as Prisma.InputJsonObject },
    });
    failed += res.count;
  }
  if (failed > 0)
    logger.warn(
      { failed, scanned: candidates.length },
      '[reconcile] médias figés en PROCESSING passés en échec',
    );
  return failed;
}
