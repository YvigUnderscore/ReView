// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useT, intlLocale } from '../../i18n';
import { useSgLinks, type SgLinkType } from './useSgLinks';

/**
 * Alignment state of an entity with ShotGrid, and the action to restore it.
 *
 * A dot rather than a badge: on a list of two hundred plans, one word per row drowns out
 * what the user came to read. Colour conveys the essentials (present on the site or not)
 * and the tooltip gives the date of the last re-read. A click re-reads only that entity,
 * without touching the rest of the project.
 *
 * Nothing is shown on an unlinked project: a studio without ShotGrid should not see dots
 * that mean nothing to it.
 */
export default function SgSyncDot({
  projectId,
  type,
  localId,
  canRealign,
}: {
  projectId: number;
  type: SgLinkType;
  localId: number | null | undefined;
  /** Realignment writes to the database: reserved for whoever manages the project. */
  canRealign?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { stateFor, syncedAtFor } = useSgLinks(projectId);
  const [busy, setBusy] = useState(false);
  const state = stateFor(type, localId);

  if (state === 'off') return null;

  const syncedAt = syncedAtFor(type, localId);
  const title =
    state === 'linked'
      ? t('shotgrid.sync.dot.linked', {
          date: syncedAt ? new Date(syncedAt).toLocaleString(intlLocale()) : '—',
        })
      : t('shotgrid.sync.dot.unlinked');

  const realign = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canRealign || state !== 'linked' || busy || !localId) return;
    setBusy(true);
    try {
      const { status } = await api.post<{ status: string }>(`/api/shotgrid/projects/${projectId}/realign`, {
        localType: type,
        localId,
      });
      // "deferred": a sync was already running, so the re-read waits its turn.
      // Announcing "realigned" would be wrong: that is exactly what the screen did when
      // the server dropped the request while reporting success. The tone follows the
      // message: green says "done", yet nothing is done while the current pass is running.
      if (status === 'deferred') toast.info(t('shotgrid.sync.dot.queued'));
      else toast.success(t('shotgrid.sync.dot.realigned'));
      // What was just re-read may have changed name, status or dates:
      // invalidate broadly rather than guessing which screen was displaying it.
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('shotgrid.sync.failed'));
    } finally {
      setBusy(false);
    }
  };

  const colour = state === 'linked' ? 'bg-success' : 'bg-warning';

  if (!canRealign || state !== 'linked')
    return <span title={title} className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${colour}`} />;

  /*
   * The dot stays a 6 px point (it is a signal, not a button), but its clickable area is
   * 24 px, the WCAG 2.5.8 minimum. Measured before the fix: twelve 6 x 6 px targets on a
   * single plan list, impossible to hit without several attempts.
   *
   * The negative margin stops this area from pushing neighbouring elements away: the dot
   * keeps exactly the space it had.
   */
  return (
    <button
      type="button"
      onClick={realign}
      disabled={busy}
      title={`${title} · ${t('shotgrid.sync.dot.realign')}`}
      aria-label={`${title} · ${t('shotgrid.sync.dot.realign')}`}
      className="group/dot -m-2 inline-flex h-6 w-6 shrink-0 items-center justify-center p-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {busy ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${colour} group-hover/dot:hidden`} />
          <RefreshCw size={11} className="hidden group-hover/dot:inline" />
        </>
      )}
    </button>
  );
}
