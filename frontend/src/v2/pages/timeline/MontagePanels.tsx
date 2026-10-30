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
 * Inspector dock of the montage (Phase 46) — same tabs, same primitives as the review, hence
 * **Info and Export** since the flat-media dock was reduced to them (Phase 50).
 *
 * The "Playback" tab was folded into the rest: it showed the frame rate, duration, number of shots
 * and gaps, all already in the technical sheet. What it really had to offer — the pipeline step the
 * montage shows — moved to the Info tab, under the sheet: it is the only choice in this dock and
 * did not need a tab of its own.
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
            // A gap in the montage changes what is being watched: the sheet says so with a badge,
            // not a bare figure — it was the only contribution of the former "Playback" tab.
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
        {/* The montage is the only scope that carries a continuous timecode: this is where the
            EDL and OTIO make sense, and it is through them that notes flow back to the editing
            suite. */}
        <Group title={t('notesExport.title')}>
          <NotesExportButtons scope="timeline" id={timeline.id} />
          <span className="rv-optbar__hint whitespace-normal">{t('notesExport.editorialHint')}</span>
        </Group>
      </>
    );

  // The flat dock now has only these two tabs: there is no "not applicable" case left to
  // explain to the reader.
  return null;
}
