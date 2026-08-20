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
import { sheetRows } from './mediaSheet';
import InfoPanel from './InfoPanel';
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
      <Group title={kind === 'VIDEO' ? t('tokens.read') : t('display.title')}>
        <Row label={t('review.frameRate')} hint={t('review.playbackRate')}>
          <span className="font-mono text-xs">{fps} fps</span>
        </Row>
        <span className="rv-optbar__hint whitespace-normal">
          {kind === 'VIDEO' ? t('panels.videoTransportHint') : t('panels.imageTransportHint')}
        </span>
      </Group>
    );

  if (panel === 'image')
    return (
      <Group title={t('viewer.color.title')}>
        <Row label={t('ocio.display')}>
          <Badge variant="secondary">{data.projectColor?.display ?? 'sRGB'}</Badge>
        </Row>
        <Row label={t('ocio.view')}>
          <Badge variant="secondary">{data.projectColor?.view ?? t('common.none')}</Badge>
        </Row>
        <span className="rv-optbar__hint whitespace-normal">{t('review.projectOcio')}</span>
      </Group>
    );

  if (panel === 'guides') return <GuidesPanel />;

  if (panel === 'compare')
    return (
      <>
        <Group title="Versions">
          <Row label="A">
            <Badge variant="default">{t('version.current')}</Badge>
          </Row>
          <Row label="B">
            {compare.ids.length ? (
              <Badge variant="secondary">{t('reviews.count', { count: compare.ids.length })}</Badge>
            ) : (
              <Badge variant="muted">{t('review.none')}</Badge>
            )}
          </Row>
          <span className="rv-optbar__hint whitespace-normal">{t('review.compareInHeader')}</span>
        </Group>
        {compare.ids.length > 0 && (
          <Group title={t('common.mode')}>
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
                {kind === 'VIDEO' ? t('panels.currentFramePng') : t('panels.viewPng')}
              </Button>
            )}
            {onContactSheet && (
              <Button size="sm" variant="ghost" onClick={onContactSheet}>
                <LayoutGrid size={13} />
                {t('ctx.contactSheet')}
              </Button>
            )}
            {kind === 'VIDEO' && data.trim && (
              <span className="rv-optbar__hint whitespace-normal">
                <Scissors size={12} /> {t('review.trimmedProxy')}
              </span>
            )}
            {!onExportFrame && !onContactSheet && (
              <span className="rv-optbar__hint whitespace-normal">
                <FileDown size={12} /> {t('review.onlyOriginal')}
              </span>
            )}
          </>
        }
      />
    );

  return null;
}
