// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import { useT } from '../../i18n';

/** GET/POST /api/timelines/:id/export */
interface ExportState {
  ready: boolean;
  url: string | null;
  size: number | null;
  state: string | null;
}

/** Un export est en cours tant que le job n'est ni terminé ni en échec. */
const RUNNING = ['waiting', 'active', 'delayed', 'waiting-children', 'prioritized'];

/**
 * Export d'un montage en fichier unique (Phase 45).
 *
 * La lecture dans l'application n'encode rien : ce master n'existe que pour sortir de
 * l'outil — envoi à un client, dépôt sur un serveur, archivage. Il est donc produit à la
 * demande, et le bouton bascule en téléchargement dès qu'un fichier est disponible.
 */
export default function TimelineExportButton({
  timelineId,
  disabled,
  icon,
}: {
  timelineId: number;
  disabled?: boolean;
  icon: ReactNode;
}) {
  const t = useT();
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const canExport = role === 'ADMIN' || role === 'SUPERVISOR';

  const stateQ = useQuery({
    queryKey: qk.timelineExport(timelineId),
    queryFn: () => api.get<ExportState>(`/api/timelines/${timelineId}/export`),
    // Tant que l'encodage tourne, on redemande : c'est la seule façon de savoir qu'il a fini.
    refetchInterval: (query) => (RUNNING.includes(query.state.data?.state ?? '') ? 4000 : false),
  });
  const status = stateQ.data ?? null;

  const start = useMutation({
    mutationFn: () => api.post<ExportState>(`/api/timelines/${timelineId}/export`, {}),
    onSuccess: () => {
      toast.success(t('timeline.exportStarted'));
      void qc.invalidateQueries({ queryKey: qk.timelineExport(timelineId) });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.generic')),
  });

  const running = RUNNING.includes(status?.state ?? '');
  const label = running
    ? t('timeline.exportRunning')
    : status?.ready
      ? t('timeline.exportDownload')
      : t('timeline.export');

  if (status?.ready && !running && status.url)
    return (
      <a
        href={status.url}
        download
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60"
        title={t('timeline.exportHint')}
      >
        {icon} {label}
      </a>
    );

  if (!canExport) return null;
  return (
    <button
      onClick={() => start.mutate()}
      disabled={disabled || running || start.isPending}
      title={t('timeline.exportHint')}
      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary/60 disabled:opacity-40"
    >
      {icon} {label}
    </button>
  );
}
