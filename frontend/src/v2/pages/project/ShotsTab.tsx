// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Bell, BellOff, Clapperboard, ExternalLink, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useWatch } from '../../lib/useWatch';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../../components/EntityCard';
import { useStatusMenu } from '../../lib/useStatusMenu';
import { useOmitMenu } from '../../lib/useOmitMenu';
import { entriesOf } from '../../lib/menuSpec';
import ConfirmDialog from '../../components/ConfirmDialog';
import BatchGenerator from '../../components/BatchGenerator';
import EmptyState from '../../components/ui/empty-state';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import EntityFilters from '../../components/EntityFilters';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { EMPTY_FILTERS, applyFilters } from '../../lib/entityFilters';
import { usePipelineStatuses } from '../../lib/shotgridApi';
import { useDepartments } from '../../lib/departmentsApi';
import { sortByCode, type Nomenclature, type Sequence, type Shot } from './projectTypes';
import { useT } from '../../i18n';
import SgCreationLock from '../../components/shotgrid/SgCreationLock';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';

/**
 * Onglet Shots : création en lot, cartes groupées par séquence, filtres partagés (C4).
 *
 * La liste n'avait ni recherche ni filtre : sur un long-métrage — deux mille plans — il
 * n'existait aucun moyen d'y retrouver quoi que ce soit autrement qu'en faisant défiler.
 * Les critères et les présélections nommées sont les mêmes qu'au kanban.
 */
export default function ShotsTab({
  projectId,
  sequences,
  shots,
  canManage,
  reload,
  nomenclature,
}: {
  projectId: number;
  sequences: Sequence[];
  shots: Shot[];
  canManage: boolean;
  reload: () => Promise<void>;
  nomenclature: Nomenclature;
}) {
  const t = useT();
  const view = useViewMode(`shots:${projectId}`);
  // Suivi de notifications par shot (32.G, clic droit).
  const watch = useWatch();
  const [editing, setEditing] = useState<Shot | null>(null);
  const [deleting, setDeleting] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { data: statuses = [] } = usePipelineStatuses('shot', projectId);
  // Statut par clic droit : le geste le plus fréquent de la production n'a plus à passer
  // par la fiche du plan puis son panneau de réglages.
  const { entry: statusEntry } = useStatusMenu(projectId, 'shot');
  // Omission du montage : décision de production, elle aussi au clic droit (UI simple).
  const { entry: omitEntry } = useOmitMenu(projectId);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);

  // Drawer piloté par l'URL (?shot=ID) : back/forward et partage de lien cohérents (10.A6)

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
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const visible = applyFilters(filters, shots, (shot) => ({
    text: `${shot.code} ${shot.name}`,
    statusId: shot.pipelineStatusId,
    sequenceId: shot.sequenceId,
    departmentIds: shot.departments?.map((d) => d.id),
  }));

  const groups = [
    ...sortedSequences.map((s) => ({
      seq: s,
      list: visible.filter((sh) => sh.sequenceId === s.id),
    })),
    { seq: null as Sequence | null, list: visible.filter((sh) => sh.sequenceId === null) },
    // Un groupe vide n'apporte rien quand on filtre : il n'y a plus rien à y ranger.
  ].filter((g) => g.list.length > 0);

  const sgLinks = useSgLinks(projectId);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('shots.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <EntityFilters
            scope={`shots:${projectId}`}
            value={filters}
            onChange={setFilters}
            statuses={statuses.map((s) => ({ value: String(s.id), label: s.name }))}
            sequences={sortedSequences.map((s) => ({ value: String(s.id), label: s.code }))}
            departments={departments.map((d) => ({ value: String(d.id), label: d.name }))}
            searchPlaceholder={t('shots.searchPlaceholder')}
          />
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
                  to={`/shots/${shot.id}`}
                  title={`${shot.code} · ${shot.name}`}
                  subtitle={
                    t('task.count', { count: shot._count?.tasks ?? 0 }) +
                    (shot.assets?.length ? ` · ${t('assets.count', { count: shot.assets.length })}` : '')
                  }
                  thumbnailUrl={shot.thumbnailUrl}
                  badge={
                    <span className="flex items-center gap-1">
                      {/* Coupé au montage : la carte le dit, sinon la case cochée du clic
                          droit serait le seul endroit où l'état existe. */}
                      {shot.omitted && (
                        <span title={t('shots.omitted')} className="text-muted-foreground">
                          <EyeOff size={12} />
                        </span>
                      )}
                      <PipelineStatusBadge statusId={shot.pipelineStatusId} scope="shot" size="xs" />
                      <SgSyncDot projectId={projectId} type="shot" localId={shot.id} canRealign={canManage} />
                    </span>
                  }
                  favorite={{ type: 'SHOT', entityId: shot.id }}
                  actions={actions}
                  contextEntries={entriesOf(
                    statusEntry(shot, { canEdit: canManage }),
                    omitEntry(shot, { canEdit: canManage }),
                  )}
                  contextActions={[...sgAction, watchAction, ...actions]}
                />
              );
            })}
          </EntityContainer>
        </section>
      ))}

      {editing && (
        <EntitySettingsDialog
          kind="shot"
          id={editing.id}
          projectId={projectId}
          entity={editing}
          thumbnailUrl={editing.thumbnailUrl}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
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
