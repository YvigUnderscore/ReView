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
    COMMENT_EVENTS.forEach((ev) => socket.on(ev, onComment));
    socket.on('task:update', onTask);
    socket.on('version:update', onVersion);
    socket.on('media:update', onMedia);
    socket.on('timeline:update', onTimeline);
    return () => {
      COMMENT_EVENTS.forEach((ev) => socket.off(ev, onComment));
      socket.off('task:update', onTask);
      socket.off('version:update', onVersion);
      socket.off('media:update', onMedia);
      socket.off('timeline:update', onTimeline);
    };
  }, [qc]);
}
