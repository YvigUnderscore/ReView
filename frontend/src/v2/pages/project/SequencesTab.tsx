// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import ConfirmDialog from '../../components/ConfirmDialog';
import CreateEntityButton from '../../components/entity/CreateEntityButton';
import MarkAllSeenButton from '../../components/entity/MarkAllSeenButton';
import EmptyState from '../../components/ui/empty-state';
import SelectionBar from '../../components/ui/selection-bar';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { bulkDelete } from '../../lib/bulkApi';
import { useStatusMenu } from '../../lib/useStatusMenu';
import { useEntityMenus } from '../../lib/useEntityMenus';
import { entityCardMenu } from './entityCardMenu';
import TimelineCard from '../timeline/TimelineCard';
import { sortByCode, type Nomenclature, type Sequence } from './projectTypes';
import { useT } from '../../i18n';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';

/**
 * Sequences tab (C3).
 *
 * The whole-film edit opens the tab: it used to live in the overview, far from the sequences that
 * make it up. Each sequence leads to its page: the accordion reloaded a detail on each expansion,
 * and hid the sequence's edit behind two clicks.
 *
 * Sequences are presented like the shots and assets: same card, same grid/list toggle, same
 * multi-selection. It was the last tab to have its own layout and its own gestures, and the gesture
 * learned elsewhere did not work there.
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
  // Status by right-click: the same vocabulary as on the shots and the kanban.
  const { entry: statusEntry } = useStatusMenu(projectId, 'sequence');
  const { peopleEntry, hideEntry, dialog: entityDialog } = useEntityMenus(projectId, 'sequences');

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

  /**
   * Menu shared by the three tabs (`entityCardMenu`): same order, same vocabulary. A sequence has
   * neither notification tracking nor omission: the missing entries do not shift the others.
   */
  const menuFor = (s: Sequence) =>
    entityCardMenu({
      t,
      kind: 'sequence',
      canManage,
      sgUrl: sgLinks.linkFor('sequence', s.id),
      state: {
        status: statusEntry(s, { canEdit: canManage }),
        people: peopleEntry({ id: s.id, label: s.code, assignees: s.assignees }, canManage),
        hide: hideEntry({ id: s.id, label: s.code }),
      },
      onOpen: () => void navigate(`/sequences/${s.id}`),
      onSettings: () => setEditing(s),
      onTrash: () => setDeleting(s),
    });

  /** The name adds nothing when it repeats the code, as most imports do. */
  const subtitleFor = (s: Sequence): string | undefined =>
    [
      s.name === s.code ? null : s.name,
      s._count.shots > 0 ? t('sequence.shotCount', { count: s._count.shots }) : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <div>
      {/* Whole-film edit (45): all the sequences end to end, kept up to date automatically. */}
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
          <MarkAllSeenButton
            target="SEQUENCE"
            projectId={projectId}
            unseenCount={sorted.filter((s) => s.unseen).length}
          />
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
          {sorted.map((s) => {
            const menu = menuFor(s);
            return (
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
                  unseen: s.unseen,
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
                actions={menu.hoverActions}
                contextEntries={menu.contextEntries}
                contextActions={menu.contextActions}
              />
            );
          })}
        </EntityContainer>
      )}

      {canManage && (
        <SelectionBar
          count={sel.count}
          label={t('sequences.countLabel', { count: sel.count })}
          onClear={sel.clear}
          actions={[
            {
              // The gesture moves to the trash (`softDelete`): say so, as on the card.
              label: t('common.moveToTrash'),
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => setBulkDeleting(true),
            },
          ]}
        />
      )}

      {entityDialog}
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
