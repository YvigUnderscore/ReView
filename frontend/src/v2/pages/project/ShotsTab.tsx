// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Bell, BellOff, Clapperboard, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useWatch } from '../../lib/useWatch';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../../components/EntityCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import BatchGenerator from '../../components/BatchGenerator';
import EmptyState from '../../components/ui/empty-state';
import ShotDetailDrawer from './ShotDetailDrawer';
import ShotEditDialog from './ShotEditDialog';
import { sortByCode, type Nomenclature, type Sequence, type Shot } from './projectTypes';
import type { PipelineSettings } from '../../types/api';
import { useT } from '../../i18n';
import SgCreationLock from '../../components/shotgrid/SgCreationLock';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';

/**
 * Onglet Shots : création en lot (Shots/Sequences creation), cartes groupées par séquence,
 * détail d'un shot en drawer latéral (10.C1) piloté par l'URL (?shot=ID).
 */
export default function ShotsTab({
  projectId,
  sequences,
  shots,
  canManage,
  reload,
  focusId = null,
  onFocus,
  nomenclature,
  pipeline,
}: {
  projectId: number;
  sequences: Sequence[];
  shots: Shot[];
  canManage: boolean;
  reload: () => Promise<void>;
  focusId?: number | null;
  onFocus: (id: number | null) => void;
  nomenclature: Nomenclature;
  pipeline: PipelineSettings;
}) {
  const t = useT();
  const view = useViewMode(`shots:${projectId}`);
  // Suivi de notifications par shot (32.G, clic droit).
  const watch = useWatch();
  const [editing, setEditing] = useState<Shot | null>(null);
  const [deleting, setDeleting] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drawer piloté par l'URL (?shot=ID) : back/forward et partage de lien cohérents (10.A6)
  const openShot = focusId != null ? (shots.find((s) => s.id === focusId) ?? null) : null;

  const sortedSequences = sortByCode(sequences);

  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/shots/bulk', {
      projectId,
      items: rows.map((r) => ({
        code: r.code,
        name: r.name || r.code,
        sequenceId: r.sequenceId ? Number(r.sequenceId) : null,
      })),
    });
    toast.success(t('shots.created', { count: rows.length }));
    await reload();
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/shots/${deleting.id}`);
      toast.success(t('shots.trashed'));
      setDeleting(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const groups = [
    ...sortedSequences.map((s) => ({
      seq: s as Sequence | null,
      list: shots.filter((sh) => sh.sequenceId === s.id),
    })),
    { seq: null as Sequence | null, list: shots.filter((sh) => sh.sequenceId === null) },
  ].filter((g) => g.list.length > 0 || g.seq);

  const sgLinks = useSgLinks(projectId);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('shots.title')}</h2>
        <div className="flex items-center gap-2">
          <ViewToggle contextKey={`shots:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {canManage && (
        <SgCreationLock projectId={projectId} kind="shot">
          <BatchGenerator
            defaults={{
              prefix: nomenclature.shotPrefix,
              step: nomenclature.step,
              padding: nomenclature.padding,
            }}
            sequences={sortedSequences}
            onSubmit={(items) =>
              createBulk(
                items.map((it) => ({
                  code: it.code,
                  name: it.name,
                  sequenceId: it.sequenceId != null ? String(it.sequenceId) : '',
                })),
              )
            }
          />
        </SgCreationLock>
      )}
      {shots.length === 0 && (
        <EmptyState
          compact
          icon={Clapperboard}
          title={t('shots.empty.title')}
          description={canManage ? t('shots.empty.hint') : t('shots.empty.description')}
        />
      )}

      {groups.map((g) => (
        <section key={g.seq?.id ?? 'none'} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.seq ? `${g.seq.code} · ${g.seq.name}` : t('shots.noSequence')}
          </h3>
          <EntityContainer view={view}>
            {g.list.map((shot) => {
              const actions = canManage
                ? [
                    { icon: EditIcon, label: t('common.edit'), onClick: () => setEditing(shot) },
                    {
                      icon: DeleteIcon,
                      label: t('common.delete'),
                      danger: true,
                      onClick: () => setDeleting(shot),
                    },
                  ]
                : [];
              // Lien direct vers la fiche ShotGrid — clic droit seulement, et seulement
              // si le projet est relié : sur un projet autonome, l'entrée n'existe pas.
              const sgUrl = sgLinks.linkFor('shot', shot.id);
              const sgAction = sgUrl
                ? [
                    {
                      icon: <ExternalLink size={14} />,
                      label: t('shotgrid.openIn.shot'),
                      onClick: () => window.open(sgUrl, '_blank', 'noreferrer'),
                    },
                  ]
                : [];
              // Suivi (32.G) : action de clic droit uniquement (UI simple).
              const watching = watch.isWatching('SHOT', shot.id);
              const watchAction = {
                icon: watching ? <BellOff size={14} /> : <Bell size={14} />,
                label: watching ? t('shots.unwatch') : t('shots.watch'),
                onClick: () => watch.toggle('SHOT', shot.id),
              };
              return (
                <EntityCard
                  key={shot.id}
                  view={view}
                  onClick={() => onFocus(focusId === shot.id ? null : shot.id)}
                  active={focusId === shot.id}
                  title={`${shot.code} · ${shot.name}`}
                  subtitle={
                    t('task.count', { count: shot._count?.tasks ?? 0 }) +
                    (shot.assets?.length ? ` · ${t('assets.count', { count: shot.assets.length })}` : '')
                  }
                  thumbnailUrl={shot.thumbnailUrl}
                  favorite={{ type: 'SHOT', entityId: shot.id }}
                  actions={actions}
                  contextActions={[...sgAction, watchAction, ...actions]}
                />
              );
            })}
          </EntityContainer>
        </section>
      ))}

      {/* Détail du shot ouvert : drawer latéral (remplace l'accordéon inline) */}
      <ShotDetailDrawer
        shot={openShot}
        projectId={projectId}
        canManage={canManage}
        onClose={() => onFocus(null)}
        reload={reload}
      />

      {editing && (
        <ShotEditDialog
          shot={editing}
          sequences={sortedSequences}
          pipeline={pipeline}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('shots.delete.title')}
        message={t('shots.delete.message', { code: deleting?.code ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
