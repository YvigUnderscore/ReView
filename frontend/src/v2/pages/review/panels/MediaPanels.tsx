// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, FileDown, LayoutGrid, Scissors } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { MediaKind } from '../../../types/api';
import type { PanelId } from '../chrome/panels';
import { sheetRows } from './mediaSheet';
import InfoPanel from './InfoPanel';
import ExportPanel from './ExportPanel';
import type { MediaResp } from '../reviewTypes';
import { useT } from '../../../i18n';

/**
 * Contenu du dock inspecteur pour les viewers plats : la fiche technique et l'export.
 *
 * Les autres onglets sont partis en Phase 50 — `chrome/panels.ts` dit lequel et pourquoi. Ce
 * qu'ils réglaient vit maintenant là où l'on regarde : la comparaison A/B dans la barre
 * d'options du mode « Compare », les repères de composition au clic droit du viewer.
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
            {/* Le proxy déjà découpé ne se refait plus (la découpe a disparu en Phase 50),
                mais le dire reste dû : le fichier d'origine exporté ici est plus long que ce
                que le lecteur montre. */}
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
