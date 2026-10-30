// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Clapperboard, EyeOff, Plus, Settings2 } from 'lucide-react';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import EmptyState from '../../components/ui/empty-state';
import EntityCard, { EntityContainer } from '../../components/EntityCard';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import ViewToggle from '../../components/ViewToggle';
import { useViewMode } from '../../stores/useViewPref';
import { useStatusMenu } from '../../lib/useStatusMenu';
import { useOmitMenu } from '../../lib/useOmitMenu';
import { entriesOf } from '../../lib/menuSpec';
import type { SequenceDetailData } from '../project/projectTypes';
import type { AddShotsMode } from './SequenceAddShotsDialog';
import { useT } from '../../i18n';

/**
 * The shots of a sequence (C3).
 *
 * They used to be rendered by a home-made grid with no context menu: a right click on a shot
 * bubbled up to the page container and opened **the sequence's settings** — the user believed
 * they were editing the shot they had targeted. Going through `EntityCard`, as the Shots tab
 * does, fixes the gesture and, along the way, brings everything that was missing here: status on
 * right click, omit on mount, description, assignees, cards/compact toggle.
 *
 * An empty sequence used to say only "no shots". Yet that is exactly where the gesture is most
 * needed: the empty state therefore carries the action, and the header keeps a single "+" — the
 * choice between creating and attaching is made in the dialog, not by two neighbouring buttons.
 */
export default function SequenceShotGrid({
  shots,
  projectId,
  canManage,
  onChanged,
  onAdd,
}: {
  shots: SequenceDetailData['shots'];
  projectId: number;
  canManage: boolean;
  onChanged: () => void;
  /** Opens adding shots; absent when the page does not offer it. */
  onAdd?: (mode: AddShotsMode) => void;
}) {
  const t = useT();
  const view = useViewMode(`sequence-shots:${projectId}`);
  const [editing, setEditing] = useState<SequenceDetailData['shots'][number] | null>(null);
  const { entry: statusEntry } = useStatusMenu(projectId, 'shot');
  const { entry: omitEntry } = useOmitMenu(projectId);
  const canAdd = canManage && onAdd !== undefined;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t('shots.title')} ({shots.length})
        </h2>
        <div className="flex items-center gap-2">
          {canAdd && (
            <button
              onClick={() => onAdd('create')}
              title={t('sequenceShots.add')}
              aria-label={t('sequenceShots.add')}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus size={16} />
            </button>
          )}
          <ViewToggle contextKey={`sequence-shots:${projectId}`} />
        </div>
      </div>

      {shots.length === 0 ? (
        <EmptyState
          compact
          icon={Clapperboard}
          title={t('sequences.noShot')}
          description={canAdd ? t('sequenceShots.empty.hint') : undefined}
          action={canAdd ? t('sequenceShots.add') : undefined}
          onAction={canAdd ? () => onAdd('create') : undefined}
        />
      ) : (
        <EntityContainer view={view}>
          {shots.map((shot) => (
            <EntityCard
              key={shot.id}
              view={view}
              to={`/shots/${shot.id}`}
              title={shot.code}
              subtitle={shot.name !== shot.code ? shot.name : undefined}
              thumbnailUrl={shot.thumbnailUrl}
              meta={{
                description: shot.description,
                assignees: shot.assignees,
                awaitingReview: shot.awaitingReview,
                unseen: shot.unseen,
                updatedAt: shot.updatedAt,
              }}
              badge={
                <span className="flex items-center gap-1">
                  {/* A shot omitted on mount stays viewable: it is flagged, not hidden. */}
                  {shot.omitted && (
                    <span title={t('shots.omitted')} className="text-muted-foreground">
                      <EyeOff size={12} />
                    </span>
                  )}
                  <PipelineStatusBadge statusId={shot.pipelineStatusId} scope="shot" size="xs" />
                </span>
              }
              favorite={{ type: 'SHOT', entityId: shot.id }}
              contextEntries={entriesOf(
                statusEntry(shot, { canEdit: canManage }),
                omitEntry(shot, { canEdit: canManage }),
              )}
              contextActions={
                canManage
                  ? [
                      {
                        icon: <Settings2 size={14} />,
                        label: t('entity.settings.open'),
                        onClick: () => setEditing(shot),
                      },
                    ]
                  : []
              }
            />
          ))}
        </EntityContainer>
      )}

      {editing && (
        <EntitySettingsDialog
          kind="shot"
          id={editing.id}
          projectId={projectId}
          entity={editing}
          thumbnailUrl={editing.thumbnailUrl}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </section>
  );
}
