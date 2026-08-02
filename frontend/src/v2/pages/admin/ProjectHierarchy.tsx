// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Clapperboard, Layers } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Panel } from './AdminPrimitives';
import { pipelineLabel } from './adminProjects';
import type { AdminHierarchySequence, AdminHierarchyShot, PipelineSettings } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Hiérarchie séquences → shots d'un projet (fiche admin) : à chaque niveau, les
 * réglages pipeline **effectifs** après héritage projet→séquence→shot, avec un badge
 * « override » quand le niveau redéfinit résolution ou framerate.
 */

function SettingsChip({ effective, override }: { effective: PipelineSettings; override: boolean }) {
  const t = useT();
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      {pipelineLabel(effective)}
      {override ? (
        <Badge variant="secondary">override</Badge>
      ) : (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {t('common.inherited')}
        </span>
      )}
    </span>
  );
}

function ShotRow({ shot }: { shot: AdminHierarchyShot }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-6 text-sm">
      <Clapperboard size={13} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{shot.code}</span>
        <span className="text-muted-foreground"> · {shot.name}</span>
        {shot.startFrame != null && shot.endFrame != null && (
          <span className="ml-1 text-xs text-muted-foreground">
            [{shot.startFrame}–{shot.endFrame}]
          </span>
        )}
      </span>
      <SettingsChip effective={shot.effective} override={shot.override} />
    </div>
  );
}

export default function ProjectHierarchy({
  sequences,
  noSequence,
  project,
}: {
  sequences: AdminHierarchySequence[];
  noSequence: AdminHierarchyShot[];
  project: PipelineSettings;
}) {
  const t = useT();
  return (
    <Panel title={t('hierarchy.title')}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium">Projet</span>
        <SettingsChip effective={project} override={false} />
      </div>
      <div className="divide-y divide-border">
        {sequences.map((seq) => (
          <div key={seq.id} className="py-1.5">
            <div className="flex items-center gap-2 text-sm">
              <Layers size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{seq.code}</span>
                <span className="text-muted-foreground"> · {seq.name}</span>
                <span className="ml-1 text-xs text-muted-foreground">({seq.shots.length} shots)</span>
              </span>
              <SettingsChip effective={seq.effective} override={seq.override} />
            </div>
            {seq.shots.map((shot) => (
              <ShotRow key={shot.id} shot={shot} />
            ))}
            {seq.shots.length === 0 && (
              <p className="pl-6 text-xs text-muted-foreground">{t('sequences.noShot')}</p>
            )}
          </div>
        ))}
        {noSequence.length > 0 && (
          <div className="py-1.5">
            <div className="flex items-center gap-2 text-sm">
              <Layers size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {t('hierarchy.shotsWithoutSequence')}
              </span>
            </div>
            {noSequence.map((shot) => (
              <ShotRow key={shot.id} shot={shot} />
            ))}
          </div>
        )}
        {sequences.length === 0 && noSequence.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">{t('hierarchy.emptyProject')}</p>
        )}
      </div>
    </Panel>
  );
}
