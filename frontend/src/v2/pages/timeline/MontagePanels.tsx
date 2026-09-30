// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, Download } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Group, Row } from '../review/chrome/DockGroup';
import InfoPanel from '../review/panels/InfoPanel';
import type { PanelId } from '../review/chrome/panels';
import TimelineExportButton from './TimelineExportButton';
import { NotesExportButtons } from '../../components/NotesExportMenu';
import { formatDuration } from '../review/timelineNav';
import type { DepartmentSummary, TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Dock inspecteur du montage (Phase 46) — mêmes onglets, mêmes primitives que la review, donc
 * **Infos et Export** depuis que le dock des médias plats s'y réduit (Phase 50).
 *
 * L'onglet « Lecture » a suivi le reste : il disait la cadence, la durée, le nombre de plans et
 * les trous, tous déjà dans la fiche technique. Ce qu'il portait de vraiment réglable —
 * l'étape du pipe que le montage montre — est passé dans l'onglet Infos, sous la fiche : c'est
 * le seul choix de ce dock, il n'avait pas besoin d'un onglet à lui.
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

  if (panel === 'info')
    return (
      <InfoPanel
        sheet={[
          { label: t('timeline.name'), value: timeline.name ?? t('timeline.defaultName') },
          { label: t('pipeline.fps'), value: `${timeline.framerate} fps` },
          { label: t('timeline.duration'), value: formatDuration(timeline.totalDuration) },
          { label: t('timeline.shots'), value: String(timeline.items.length) },
          {
            label: t('timeline.gaps'),
            // Un trou dans le montage change ce qu'on regarde : la fiche le dit en badge, pas
            // en chiffre nu — c'était le seul apport de l'ancien onglet « Lecture ».
            value:
              gaps > 0 ? (
                <Badge variant="warning">{t('timeline.gapCount', { count: gaps })}</Badge>
              ) : (
                <Badge variant="success">{t('timeline.noGap')}</Badge>
              ),
          },
          {
            label: t('timeline.revisionLabel'),
            value: timeline.latestRevision !== null ? String(timeline.latestRevision) : '—',
          },
        ]}
        extra={
          <Group title={t('timeline.stage')}>
            <Row label={t('timeline.departmentShown')} hint={t('timeline.departmentHint')} stack>
              <select
                aria-label={t('timeline.departmentShown')}
                value={timeline.department ?? ''}
                onChange={(e) => onDepartment(e.target.value || null)}
                disabled={!canManage}
                className="w-full rounded border border-input bg-background px-1.5 py-[0.3125rem] text-xs disabled:opacity-60"
              >
                <option value="">{t('timeline.departmentAuto')}</option>
                {timeline.departments.map((d: DepartmentSummary) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Row>
          </Group>
        }
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
      <>
        <Group title={t('review.export.media')}>
          <p className="text-xs leading-snug text-muted-foreground">{t('timeline.exportHint')}</p>
          <TimelineExportButton
            timelineId={timeline.id}
            disabled={!timeline.items.some((it) => it.mediaId !== null)}
            icon={<Download size={13} />}
          />
        </Group>
        {/* Le montage est la seule portée qui porte un timecode continu : c'est ici que
            l'EDL et l'OTIO ont un sens, et c'est par eux que les retours repassent en
            salle de montage. */}
        <Group title={t('notesExport.title')}>
          <NotesExportButtons scope="timeline" id={timeline.id} />
          <span className="rv-optbar__hint whitespace-normal">{t('notesExport.editorialHint')}</span>
        </Group>
      </>
    );

  // Le dock plat n'a plus que ces deux onglets : il n'y a plus de cas « sans objet » à
  // expliquer au lecteur.
  return null;
}
