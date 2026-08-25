// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Film, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import ConfirmDialog from '../../components/ConfirmDialog';
import CreateEntityButton from '../../components/entity/CreateEntityButton';
import EmptyState from '../../components/ui/empty-state';
import SelectionBar from '../../components/ui/selection-bar';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer, EditIcon, DeleteIcon } from '../../components/EntityCard';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { entriesOf, separator, type EntityItemAction, type MenuEntry } from '../../lib/menuSpec';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { bulkDelete } from '../../lib/bulkApi';
import { useStatusMenu } from '../../lib/useStatusMenu';
import TimelineCard from '../timeline/TimelineCard';
import { sortByCode, type Nomenclature, type Sequence } from './projectTypes';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';

/**
 * Onglet Séquences (C3).
 *
 * Le montage du film entier ouvre l'onglet — il vivait dans la vue d'ensemble, loin des
 * séquences qui le composent. Chaque séquence mène à sa page : l'accordéon rechargeait un
 * détail à chaque dépliage, et cachait le montage de la séquence derrière deux clics.
 *
 * Les séquences se présentent comme les plans et les assets — même carte, même bascule
 * grille/liste, même multi-sélection : c'était le dernier onglet à avoir sa mise en page
 * et ses gestes à lui, et le geste appris ailleurs n'y marchait pas.
 */
export default function SequencesTab({
  projectId,
  sequences,
  canManage,
  reload,
  nomenclature,
}: {
  projectId: number;
  sequences: Sequence[];
  canManage: boolean;
  reload: () => Promise<void>;
  nomenclature: Nomenclature;
}) {
  const t = useT();
  const navigate = useNavigate();
  const view = useViewMode(`sequences:${projectId}`);
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [deleting, setDeleting] = useState<Sequence | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sgLinks = useSgLinks(projectId);
  const sorted = sortByCode(sequences);
  const sel = useMultiSelect(sorted.map((s) => s.id));
  // Statut par clic droit — même vocabulaire que sur les plans et le kanban.
  const { entry: statusEntry } = useStatusMenu(projectId, 'sequence');

  const createBulk = async (rows: Record<string, string>[]) => {
    await api.post('/api/sequences/bulk', {
      projectId,
      items: rows.map((r) => ({ code: r.code, name: r.name || r.code })),
    });
    toast.success(t('sequences.createdCount', { count: rows.length }));
    await reload();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/sequences/${deleting.id}`);
      toast.success(t('sequences.trashed'));
      setDeleting(null);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  const confirmBulkDelete = async () => {
    try {
      const { count } = await bulkDelete('sequences', sel.ids);
      toast.success(t('sequences.trashedCount', { count }));
      sel.clear();
      setBulkDeleting(false);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error.generic'));
    }
  };

  /** Boutons au survol de la carte — les mêmes que sur un plan. */
  const actionsFor = (s: Sequence): EntityItemAction[] =>
    canManage
      ? [
          { icon: EditIcon, label: t('entity.settings.open'), onClick: () => setEditing(s) },
          { icon: DeleteIcon, label: t('common.delete'), danger: true, onClick: () => setDeleting(s) },
        ]
      : [];

  const menuFor = (s: Sequence): MenuEntry[] => {
    // Fiche ShotGrid : au clic droit comme sur les plans et les assets, et seulement si
    // la séquence y est reliée.
    const sgUrl = sgLinks.linkFor('sequence', s.id);
    return [
      { id: 'open', label: t('sequences.open'), onSelect: () => void navigate(`/sequences/${s.id}`) },
      ...entriesOf(statusEntry(s, { canEdit: canManage })),
      ...(sgUrl
        ? [
            {
              id: 'shotgrid',
              label: t('shotgrid.openIn.sequence'),
              icon: <ExternalLink size={14} />,
              onSelect: () => window.open(sgUrl, '_blank', 'noreferrer'),
            },
          ]
        : []),
      ...(canManage
        ? [
            separator('manage'),
            {
              id: 'settings',
              label: t('entity.settings.open'),
              icon: <Settings2 size={14} />,
              onSelect: () => setEditing(s),
            },
            {
              id: 'delete',
              label: t('common.moveToTrash'),
              icon: <Trash2 size={14} />,
              onSelect: () => setDeleting(s),
            },
          ]
        : []),
    ];
  };

  /** Le nom n'apporte rien quand il répète le code — la plupart des imports le font. */
  const subtitleFor = (s: Sequence): string | undefined =>
    [
      s.name === s.code ? null : s.name,
      s._count.shots > 0 ? t('sequence.shotCount', { count: s._count.shots }) : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <div>
      {/* Montage du film entier (45) : toutes les séquences bout à bout, tenu à jour seul. */}
      <TimelineCard projectId={projectId} sequenceId={null} />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('sequences.title')}</h2>
        <div className="flex items-center gap-2">
          {canManage && (
            <CreateEntityButton
              projectId={projectId}
              kind="sequence"
              defaults={{
                prefix: nomenclature.sequencePrefix,
                step: nomenclature.step,
                padding: nomenclature.padding,
              }}
              onSubmit={(items) => createBulk(items.map((it) => ({ code: it.code, name: it.name })))}
            />
          )}
          <ViewToggle contextKey={`sequences:${projectId}`} />
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {sequences.length === 0 ? (
        <EmptyState
          compact
          icon={Film}
          title={t('sequences.empty.title')}
          description={canManage ? t('sequences.empty.hint') : t('sequences.empty.description')}
        />
      ) : (
        <EntityContainer view={view}>
          {sorted.map((s) => (
            <EntityCard
              key={s.id}
              view={view}
              to={`/sequences/${s.id}`}
              title={s.code}
              subtitle={subtitleFor(s)}
              thumbnailUrl={s.thumbnailUrl}
              meta={{
                description: s.description,
                assignees: s.assignees,
                awaitingReview: s.awaitingReview,
                updatedAt: s.updatedAt,
              }}
              badge={
                <span className="flex items-center gap-1">
                  <PipelineStatusBadge statusId={s.pipelineStatusId} scope="sequence" size="xs" />
                  <SgSyncDot projectId={projectId} type="sequence" localId={s.id} canRealign={canManage} />
                </span>
              }
              favorite={{ type: 'SEQUENCE', entityId: s.id }}
              selection={
                canManage
                  ? { selected: sel.isSelected(s.id), onSelect: (m) => sel.onSelect(s.id, m) }
                  : undefined
              }
              actions={actionsFor(s)}
              contextEntries={menuFor(s)}
            />
          ))}
        </EntityContainer>
      )}

      {canManage && (
        <SelectionBar
          count={sel.count}
          label={t('sequences.countLabel', { count: sel.count })}
          onClear={sel.clear}
          actions={[
            {
              label: t('common.delete'),
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => setBulkDeleting(true),
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={bulkDeleting}
        title={t('sequences.deleteMany.title')}
        message={t('sequences.deleteMany.message', { count: sel.count })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmBulkDelete}
        onCancel={() => setBulkDeleting(false)}
      />

      {editing && (
        <EntitySettingsDialog
          kind="sequence"
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
        title={t('sequences.delete.title')}
        message={t('sequences.delete.message', { code: deleting?.code ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
