// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clapperboard, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { useWatch } from '../../lib/useWatch';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import ListSentinel, { ListCount } from '../../components/ListSentinel';
import { useStatusMenu } from '../../lib/useStatusMenu';
import { useOmitMenu } from '../../lib/useOmitMenu';
import { entriesOf } from '../../lib/menuSpec';
import CreateEntityButton from '../../components/entity/CreateEntityButton';
import EmptyState from '../../components/ui/empty-state';
import ShotBulkBar from './ShotBulkBar';
import ShotDialogs from './ShotDialogs';
import EntityFilters from '../../components/EntityFilters';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { activeCount, applyFilters } from '../../lib/entityFilters';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { bulkDelete } from '../../lib/bulkApi';
import { useShotsQuery } from '../../lib/queries';
import { usePipelineStatuses } from '../../lib/shotgridApi';
import { useDepartments } from '../../lib/departmentsApi';
import { useEntityMenus } from '../../lib/useEntityMenus';
import { shotCardActions } from './shotCardActions';
import { sortByCode, type Nomenclature, type Sequence, type Shot } from './projectTypes';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';
import { useUrlFilters } from '../../lib/useUrlFilters';

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
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useUrlFilters('shots');
  // Même liste que la page (même clé de cache), consultée ici pour ce qu'elle sait d'elle :
  // combien de plans existent, et s'il en reste à descendre. Un filtre posé sur une page
  // tronquée répondrait « aucun plan » pour un plan qui existe : on descend alors tout.
  const paging = useShotsQuery(projectId, projectId > 0, { all: activeCount(filters) > 0 });
  const { data: statuses = [] } = usePipelineStatuses('shot', projectId);
  // Statut par clic droit : le geste le plus fréquent de la production n'a plus à passer
  // par la fiche du plan puis son panneau de réglages.
  const { entry: statusEntry } = useStatusMenu(projectId, 'shot');
  // Omission du montage : décision de production, elle aussi au clic droit (UI simple).
  const { entry: omitEntry } = useOmitMenu(projectId);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);
  // Personnes responsables et masquage : deux gestes de carte, au clic droit.
  const { peopleEntry, hideEntry, dialog: entityDialog } = useEntityMenus(projectId, 'shots');

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
  // La sélection ne porte que sur ce qui est affiché — comme sur les assets : une action
  // de masse ne doit jamais atteindre une ligne que le filtre a écartée de la vue.
  const sel = useMultiSelect(visible.map((s) => s.id));

  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('shots', sel.ids);
      toast.success(t('shots.trashedCount', { count }));
      sel.clear();
      setBulkDeleting(false);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

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
          {canManage && (
            <CreateEntityButton
              projectId={projectId}
              kind="shot"
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
          )}
          <ViewToggle contextKey={`shots:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {shots.length === 0 ? (
        <EmptyState
          compact
          icon={Clapperboard}
          title={t('shots.empty.title')}
          description={canManage ? t('shots.empty.hint') : t('shots.empty.description')}
        />
      ) : (
        <ListCount
          loaded={paging.loaded}
          total={paging.total}
          label={t('shots.count', { count: paging.total })}
        />
      )}

      {groups.map((g) => (
        <section key={g.seq?.id ?? 'none'} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {/* Le titre du groupe mène à la séquence : c'est le chemin qu'on cherche en
                regardant ses plans, et il n'existait nulle part depuis cet onglet. */}
            {g.seq ? (
              <Link
                to={`/sequences/${g.seq.id}`}
                className="inline-flex items-center gap-1 transition-colors hover:text-primary"
              >
                {g.seq.code} · {g.seq.name}
                <ArrowUpRight size={12} />
              </Link>
            ) : (
              t('shots.noSequence')
            )}
          </h3>
          <EntityContainer view={view}>
            {g.list.map((shot) => {
              // Lien ShotGrid au clic droit seulement, et seulement si le projet est
              // relié : sur un projet autonome, l'entrée n'existe pas.
              const { manageActions, contextActions } = shotCardActions({
                t,
                canManage,
                sgUrl: sgLinks.linkFor('shot', shot.id),
                watching: watch.isWatching('SHOT', shot.id),
                onEdit: () => setEditing(shot),
                onDelete: () => setDeleting(shot),
                onWatch: () => watch.toggle('SHOT', shot.id),
              });
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
                  meta={{
                    description: shot.description,
                    assignees: shot.assignees,
                    awaitingReview: shot.awaitingReview,
                    updatedAt: shot.updatedAt,
                    departments: shot.departments,
                  }}
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
                  selection={
                    canManage
                      ? { selected: sel.isSelected(shot.id), onSelect: (m) => sel.onSelect(shot.id, m) }
                      : undefined
                  }
                  actions={manageActions}
                  contextEntries={entriesOf(
                    statusEntry(shot, { canEdit: canManage }),
                    peopleEntry({ id: shot.id, label: shot.code, assignees: shot.assignees }, canManage),
                    omitEntry(shot, { canEdit: canManage }),
                    hideEntry({ id: shot.id, label: shot.code }),
                  )}
                  contextActions={contextActions}
                />
              );
            })}
          </EntityContainer>
        </section>
      ))}

      {/* Hors des groupes : un filtre peut n'en laisser aucun à l'écran, et c'est
          justement là qu'il faut pouvoir descendre la suite de la liste. */}
      <ListSentinel hasMore={paging.hasMore} isLoading={paging.isFetchingMore} onLoadMore={paging.loadMore} />

      {canManage && (
        <ShotBulkBar
          projectId={projectId}
          ids={sel.ids}
          count={sel.count}
          onClear={sel.clear}
          onReload={() => void reload()}
          onDelete={() => setBulkDeleting(true)}
        />
      )}

      {entityDialog}
      <ShotDialogs
        projectId={projectId}
        editing={editing}
        deleting={deleting}
        bulkDeleting={bulkDeleting}
        bulkCount={sel.count}
        onCloseEditing={() => setEditing(null)}
        onCancelDelete={() => setDeleting(null)}
        onCancelBulk={() => setBulkDeleting(false)}
        onConfirmDelete={() => void confirmDelete()}
        onConfirmBulk={() => void confirmBulkDelete()}
        onSaved={() => void reload()}
      />
    </div>
  );
}
