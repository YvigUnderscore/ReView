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

/** An export is in progress as long as the job has neither finished nor failed. */
const RUNNING = ['waiting', 'active', 'delayed', 'waiting-children', 'prioritized'];

/**
 * Exports a montage as a single file (Phase 45).
 *
 * Playback inside the application encodes nothing: this master only exists to leave the tool — sent
 * to a client, dropped on a server, archived. It is therefore produced on demand, and the button
 * switches to a download as soon as a file is available.
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
    // While the encoding runs, keep asking: that is the only way to know it has finished.
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
