// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, FileDown, LayoutGrid, Scissors } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { MediaKind } from '../../../types/api';
import type { PanelId } from '../chrome/panels';
import { Group, Row } from '../chrome/DockGroup';
import GuidesPanel from './GuidesPanel';
import ColorPanel from '../color/ColorPanel';
import { sheetRows } from './mediaSheet';
import InfoPanel from './InfoPanel';
import ExportPanel from './ExportPanel';
import type { MediaResp } from '../reviewTypes';
import { useT } from '../../../i18n';

/**
 * Contenu du dock inspecteur pour les viewers plats — ce qu'on règle une fois.
 *
 * L'onglet « Comparaison » en est parti : il redisait l'en-tête sans offrir de version B. Les
 * réglages A et B vivent dans la barre d'options du mode « Compare », où l'on regarde déjà.
 */
export default function MediaPanels({
  panel,
  kind,
  data,
  fps,
  onExportFrame,
  onContactSheet,
}: {
  panel: PanelId | null;
  kind: MediaKind;
  data: MediaResp;
  fps: number;
  onExportFrame?: () => void;
  onContactSheet?: () => void;
}) {
  const t = useT();
  if (panel === 'playback')
    return (
      <Group title={t('tokens.read')}>
        <Row label={t('review.frameRate')}>
          <span className="font-mono text-xs">{fps} fps</span>
        </Row>
      </Group>
    );

  // Panneau Color : agissant sur l'image fixe (transformée d'affichage appliquée aux pixels),
  // encore en lecture seule ailleurs — la vidéo garde son décodage natif.
  if (panel === 'image') return <ColorPanel projectColor={data.projectColor} applies={kind === 'IMAGE'} />;

  if (panel === 'guides') return <GuidesPanel />;

  if (panel === 'info') return <InfoPanel sheet={sheetRows(t, data, kind, fps)} />;

  if (panel === 'export')
    return (
      <ExportPanel
        originalUrl={data.url}
        originalName={data.media.originalName}
        notesMediaId={data.media.id}
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
