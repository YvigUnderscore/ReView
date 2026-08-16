// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { useT, intlLocale } from '../../i18n';
import { useSgLinks, type SgLinkType } from './useSgLinks';

/**
 * État d'alignement d'une entité sur ShotGrid, et le geste pour le rétablir.
 *
 * Une pastille plutôt qu'un badge : sur une liste de deux cents plans, un mot par ligne
 * noie ce qu'on est venu lire. La couleur dit l'essentiel — présent sur le site, ou non
 * — et l'infobulle donne la date de dernière relecture. Un clic relit cette entité-là,
 * sans toucher au reste du projet.
 *
 * Rien ne s'affiche sur un projet non relié : un studio sans ShotGrid ne doit pas voir
 * apparaître des pastilles qui ne veulent rien dire pour lui.
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
  /** Le réalignement écrit en base : réservé à qui gère le projet. */
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
      await api.post(`/api/shotgrid/projects/${projectId}/realign`, { localType: type, localId });
      toast.success(t('shotgrid.sync.dot.realigned'));
      // Ce qui vient d'être relu peut avoir changé de nom, de statut ou de dates :
      // on invalide largement plutôt que de deviner quel écran l'affichait.
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

  return (
    <button
      type="button"
      onClick={realign}
      disabled={busy}
      title={`${title} · ${t('shotgrid.sync.dot.realign')}`}
      className="group/dot inline-flex shrink-0 items-center text-muted-foreground hover:text-foreground disabled:opacity-50"
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
