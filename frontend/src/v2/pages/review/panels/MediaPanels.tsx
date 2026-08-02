// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, FileDown, LayoutGrid, Scissors } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Switch } from '../../../components/ui/switch';
import type { MediaKind } from '../../../types/api';
import type { PanelId } from '../chrome/panels';
import { Group, Row } from '../chrome/DockGroup';
import GuidesPanel from './GuidesPanel';
import InfoPanel, { type InfoRow } from './InfoPanel';
import ExportPanel from './ExportPanel';
import type { MediaResp } from '../reviewTypes';
import type { CompareMode } from '../useCompareState';
import { useT, type MessageKey } from '../../../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

const compare_modes = (t: Tr) => [
  { value: 'wipe' as const, label: 'Wipe' },
  { value: 'diff' as const, label: t('review.compare.diff') },
  { value: 'side' as const, label: t('review.compare.sideBySide') },
];

/** Fiche technique du média, telle que l'API la renseigne. */
function sheetRows(t: Tr, data: MediaResp, kind: MediaKind, fps: number): InfoRow[] {
  const rows: InfoRow[] = [{ label: t('review.file'), value: data.media.originalName }];
  if (kind === 'VIDEO') {
    rows.push({ label: t('pipeline.fps'), value: `${fps} fps` });
    rows.push({ label: t('review.firstFrame'), value: String(data.startFrame) });
    if (data.hls) rows.push({ label: t('review.delivery'), value: 'HLS' });
    if (data.trim)
      rows.push({
        label: t('review.trim'),
        value: `${data.trim.inFrame} → ${data.trim.outFrame}`,
      });
  }
  if (data.projectColor?.display) rows.push({ label: 'Display', value: data.projectColor.display });
  if (data.projectColor?.view) rows.push({ label: 'View', value: data.projectColor.view });
  rows.push({ label: t('common.status'), value: data.media.status });
  return rows;
}

/**
 * Contenu du dock inspecteur pour les viewers plats. Les réglages de lecture et de
 * comparaison quittent les surcouches du lecteur pour six onglets fixes, communs à la vidéo
 * et à l'image.
 */
export default function MediaPanels({
  panel,
  kind,
  data,
  fps,
  compare,
  onExportFrame,
  onContactSheet,
}: {
  panel: PanelId | null;
  kind: MediaKind;
  data: MediaResp;
  fps: number;
  compare: {
    mode: CompareMode;
    onMode: (mode: CompareMode) => void;
    /** Médias B choisis — la sélection elle-même vit dans l'en-tête de la review. */
    ids: number[];
    onClear: () => void;
  };
  onExportFrame?: () => void;
  onContactSheet?: () => void;
}) {
  const t = useT();
  if (panel === 'playback' || panel === 'view')
    return (
      <Group title={kind === 'VIDEO' ? 'Lecture' : 'Affichage'}>
        <Row label="Cadence" hint={t('review.playbackRate')}>
          <span className="font-mono text-xs">{fps} fps</span>
        </Row>
        <span className="rv-optbar__hint whitespace-normal">
          {kind === 'VIDEO'
            ? 'Lecture, son, boucle et qualité de flux se règlent dans la ligne de transport, sous l’image.'
            : 'Zoom, rotation et miroir se règlent dans la ligne de transport, sous l’image.'}
        </span>
      </Group>
    );

  if (panel === 'image')
    return (
      <Group title={t('viewer.color.title')}>
        <Row label="Display">
          <Badge variant="secondary">{data.projectColor?.display ?? 'sRGB'}</Badge>
        </Row>
        <Row label="View">
          <Badge variant="secondary">{data.projectColor?.view ?? 'Aucune'}</Badge>
        </Row>
        <span className="rv-optbar__hint whitespace-normal">
          Configuration OCIO du projet — le média n’est pas modifié.
        </span>
      </Group>
    );

  if (panel === 'guides') return <GuidesPanel />;

  if (panel === 'compare')
    return (
      <>
        <Group title="Versions">
          <Row label="A">
            <Badge variant="default">Courante</Badge>
          </Row>
          <Row label="B">
            {compare.ids.length ? (
              <Badge variant="secondary">
                {compare.ids.length} média{compare.ids.length > 1 ? 's' : ''}
              </Badge>
            ) : (
              <Badge variant="muted">{t('review.none')}</Badge>
            )}
          </Row>
          <span className="rv-optbar__hint whitespace-normal">
            Le média comparé se choisit dans l’en-tête de la review.
          </span>
        </Group>
        {compare.ids.length > 0 && (
          <Group title="Mode">
            <SegmentedControl
              label={t('review.compare.mode')}
              items={compare_modes(t)}
              value={compare.mode}
              onChange={compare.onMode}
            />
            <Row label={t('review.compare.mode')}>
              <Switch checked onCheckedChange={() => compare.onClear()} label={t('review.compare.close')} />
            </Row>
          </Group>
        )}
      </>
    );

  if (panel === 'info') return <InfoPanel sheet={sheetRows(t, data, kind, fps)} />;

  if (panel === 'export')
    return (
      <ExportPanel
        originalUrl={data.url}
        originalName={data.media.originalName}
        staging={
          <>
            {onExportFrame && (
              <Button size="sm" variant="outline" onClick={onExportFrame}>
                <Camera size={13} />
                {kind === 'VIDEO' ? 'Frame courante (PNG)' : 'Vue affichée (PNG)'}
              </Button>
            )}
            {onContactSheet && (
              <Button size="sm" variant="ghost" onClick={onContactSheet}>
                <LayoutGrid size={13} />
                Planche contact
              </Button>
            )}
            {kind === 'VIDEO' && data.trim && (
              <span className="rv-optbar__hint whitespace-normal">
                <Scissors size={12} /> Un proxy trimé entrée → sortie est servi à tous.
              </span>
            )}
            {!onExportFrame && !onContactSheet && (
              <span className="rv-optbar__hint whitespace-normal">
                <FileDown size={12} /> Seul le fichier original est exportable ici.
              </span>
            )}
          </>
        }
      />
    );

  return null;
}
