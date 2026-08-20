// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
/** Plan, séquence ou asset : le serveur n'émet que le couple projet/identifiant. */
interface EntityEvent {
  projectId: number;
  id: number;
}

const COMMENT_EVENTS = [
  'comment:new',
  'comment:update',
  'comment:delete',
  'comment:reaction',
  'comment:reaction:remove',
];

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
    // Les payloads commentaire n'exposent pas toujours le mediaObjectId (delete,
    // réactions) : invalidation par préfixe — seule la review montée re-fetch.
    const onComment = () => {
      void qc.invalidateQueries({ queryKey: ['comments'] });
    };
    const onTask = (e: TaskEvent) => {
      if (e.shotId != null) void qc.invalidateQueries({ queryKey: qk.tasks(e.shotId) });
      void qc.invalidateQueries({ queryKey: qk.task(e.id) });
      void qc.invalidateQueries({ queryKey: qk.projectActivity(e.projectId) });
    };
    const onVersion = (e: VersionEvent) => {
      const parent =
        e.taskId != null ? `taskId=${e.taskId}` : e.assetId != null ? `assetId=${e.assetId}` : null;
      if (parent) void qc.invalidateQueries({ queryKey: qk.versions(parent) });
      void qc.invalidateQueries({ queryKey: qk.version(e.id) });
      void qc.invalidateQueries({ queryKey: qk.projectActivity(e.projectId) });
      void qc.invalidateQueries({ queryKey: ['asset'] });
      void qc.invalidateQueries({ queryKey: ['timeline'] });
    };
    const onMedia = (e: MediaEvent) => {
      // Ne jamais invalider qk.media(id) : URLs présignées en staleTime Infinity
      // (10.E1) — un refetch rechargerait le viewer en pleine lecture.
      void qc.invalidateQueries({ queryKey: qk.version(e.versionId) });
      void qc.invalidateQueries({ queryKey: ['versions'] });
      void qc.invalidateQueries({ queryKey: qk.projectActivity(e.projectId) });
      // Publier un média fait avancer l'asset et le montage : c'est tout l'intérêt de
      // l'auto-timeline (Phase 45), elle doit se remettre à jour sans rechargement.
      void qc.invalidateQueries({ queryKey: ['asset'] });
      void qc.invalidateQueries({ queryKey: ['timeline'] });
    };
    const onTimeline = () => {
      void qc.invalidateQueries({ queryKey: ['timeline'] });
    };
    /**
     * Plans, séquences et assets — le serveur émettait déjà ces trois événements et
     * personne ne les écoutait : un statut changé ailleurs (par un collègue, ou lu depuis
     * ShotGrid) n'atteignait jamais un écran ouvert. Il fallait recharger la page pour le
     * voir, ce qui donnait l'impression que le changement n'était pas passé.
     */
    const onShot = (e: EntityEvent) => {
      void qc.invalidateQueries({ queryKey: qk.shot(e.id) });
      void qc.invalidateQueries({ queryKey: qk.shotTree(e.id) });
      void qc.invalidateQueries({ queryKey: ['shots', e.projectId] });
      void qc.invalidateQueries({ queryKey: qk.projectBoard(e.projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectActivity(e.projectId) });
    };
    const onSequence = (e: EntityEvent) => {
      void qc.invalidateQueries({ queryKey: qk.sequence(e.id) });
      void qc.invalidateQueries({ queryKey: qk.sequences(e.projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectActivity(e.projectId) });
    };
    const onAsset = (e: EntityEvent) => {
      void qc.invalidateQueries({ queryKey: qk.asset(e.id) });
      void qc.invalidateQueries({ queryKey: qk.assetTree(e.id) });
      void qc.invalidateQueries({ queryKey: qk.assets(e.projectId) });
      void qc.invalidateQueries({ queryKey: qk.projectActivity(e.projectId) });
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
    };
  }, [qc]);
}
