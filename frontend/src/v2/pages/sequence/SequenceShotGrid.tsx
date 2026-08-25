// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Clapperboard, EyeOff, Settings2 } from 'lucide-react';
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
import { useT } from '../../i18n';

/**
 * Les plans d'une séquence (C3).
 *
 * Ils étaient rendus par une grille maison, sans menu contextuel : le clic droit sur un
 * plan remontait au conteneur de la page et ouvrait **les réglages de la séquence** — on
 * croyait modifier le plan qu'on visait. Passer par `EntityCard`, comme l'onglet Plans,
 * corrige le geste et rend au passage tout ce qui manquait ici : statut au clic droit,
 * omission du montage, description, responsables, bascule cartes/compact.
 */
export default function SequenceShotGrid({
  shots,
  projectId,
  canManage,
  onChanged,
}: {
  shots: SequenceDetailData['shots'];
  projectId: number;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const view = useViewMode(`sequence-shots:${projectId}`);
  const [editing, setEditing] = useState<SequenceDetailData['shots'][number] | null>(null);
  const { entry: statusEntry } = useStatusMenu(projectId, 'shot');
  const { entry: omitEntry } = useOmitMenu(projectId);

  if (shots.length === 0) {
    return <EmptyState compact icon={Clapperboard} title={t('sequences.noShot')} />;
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t('shots.title')} ({shots.length})
        </h2>
        <ViewToggle contextKey={`sequence-shots:${projectId}`} />
      </div>
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
              updatedAt: shot.updatedAt,
            }}
            badge={
              <span className="flex items-center gap-1">
                {/* Un plan coupé au montage reste consultable : il se signale, il ne
                    disparaît pas. */}
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
