// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, Download } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Group, ReadRow, Row } from '../review/chrome/DockGroup';
import InfoPanel from '../review/panels/InfoPanel';
import type { PanelId } from '../review/chrome/panels';
import TimelineExportButton from './TimelineExportButton';
import { formatDuration } from '../review/timelineNav';
import type { Department, TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Dock inspecteur du montage (Phase 46) — mêmes onglets, mêmes primitives que la review.
 *
 * Ce qu'on règle une fois y vit : l'étape du pipe que le montage montre, la révision figée,
 * l'export d'un fichier unique. Le reste est en lecture : c'est une fiche, pas un
 * formulaire.
 */
export default function MontagePanels({
  panel,
  timeline,
  canManage,
  onDepartment,
  onSnapshot,
}: {
  panel: PanelId | null;
  timeline: TimelineView;
  canManage: boolean;
  onDepartment: (department: string | null) => void;
  onSnapshot: () => void;
}) {
  const t = useT();
  const gaps = timeline.gapCount;

  if (panel === 'playback')
    return (
      <>
        <Group title={t('panel.playback')}>
          <ReadRow label={t('pipeline.fps')} value={`${timeline.framerate} fps`} />
          <ReadRow label={t('timeline.duration')} value={formatDuration(timeline.totalDuration)} />
          <ReadRow label={t('timeline.shots')} value={String(timeline.items.length)} />
          <Row label={t('timeline.gaps')}>
            {gaps > 0 ? (
              <Badge variant="warning">{t('timeline.gapCount', { count: gaps })}</Badge>
            ) : (
              <Badge variant="success">{t('timeline.noGap')}</Badge>
            )}
          </Row>
        </Group>
        <Group title={t('timeline.stage')}>
          <Row label={t('timeline.departmentShown')} hint={t('timeline.departmentHint')} stack>
            <select
              value={timeline.department ?? ''}
              onChange={(e) => onDepartment(e.target.value || null)}
              disabled={!canManage}
              className="w-full rounded border border-input bg-background px-1.5 py-[0.3125rem] text-xs disabled:opacity-60"
            >
              <option value="">{t('timeline.departmentAuto')}</option>
              {timeline.departments.map((d: Department) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
          </Row>
        </Group>
      </>
    );

  if (panel === 'info')
    return (
      <InfoPanel
        sheet={[
          { label: t('timeline.name'), value: timeline.name ?? t('timeline.defaultName') },
          { label: t('timeline.duration'), value: formatDuration(timeline.totalDuration) },
          { label: t('timeline.shots'), value: String(timeline.items.length) },
          { label: t('timeline.gaps'), value: String(gaps) },
          {
            label: t('timeline.revisionLabel'),
            value: timeline.latestRevision !== null ? String(timeline.latestRevision) : '—',
          },
        ]}
        action={
          canManage ? (
            <Button size="sm" variant="outline" onClick={onSnapshot} title={t('timeline.snapshotHint')}>
              <Camera size={13} /> {t('timeline.snapshot')}
            </Button>
          ) : undefined
        }
      />
    );

  if (panel === 'export')
    return (
      <Group title={t('review.export.media')}>
        <p className="text-xs leading-snug text-muted-foreground">{t('timeline.exportHint')}</p>
        <TimelineExportButton
          timelineId={timeline.id}
          disabled={!timeline.items.some((it) => it.mediaId !== null)}
          icon={<Download size={13} />}
        />
      </Group>
    );

  // Les autres onglets du dock vidéo (image, guides, comparaison) n'ont pas d'objet ici :
  // un montage n'a ni réglage d'image propre ni média B.
  return <p className="text-xs text-muted-foreground">{t('timeline.panelNotApplicable')}</p>;
}
