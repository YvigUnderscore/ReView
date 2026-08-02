// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Camera, FileArchive, FileDown, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Group } from '../chrome/DockGroup';
import { useT } from '../../../i18n';

/**
 * Panneau Export du dock : le média d'abord (avec ou sans les éditions cuites), la mise en
 * scène ensuite. Hérite de `SplatExportPanel`. Les exports reprennent les éditions
 * **enregistrées**, jamais la sélection en cours — c'est dit en toutes lettres au lecteur.
 */
export default function ExportPanel({
  cleaned,
  originalUrl,
  originalName,
  staging,
}: {
  /** Export du média avec les éditions appliquées (.spz nettoyé, .glb transformé). */
  cleaned?: { label: string; hint: string; busy: boolean; onExport: () => void };
  originalUrl: string;
  originalName: string;
  /** Exports de mise en scène (animation caméra, capture de vue). */
  staging?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <Group title={t('review.export.media')}>
        {cleaned && (
          <Button
            size="sm"
            variant="outline"
            disabled={cleaned.busy}
            title={cleaned.hint}
            onClick={cleaned.onExport}
          >
            {cleaned.busy ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />}
            {cleaned.label}
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <a
            href={originalUrl}
            download={originalName}
            target="_blank"
            rel="noopener noreferrer"
            title={t('review.export.original')}
          >
            <FileDown size={13} />
            Fichier original, sans édition
          </a>
        </Button>
      </Group>
      {staging && <Group title={t('review.export.staging')}>{staging}</Group>}
      <span className="rv-optbar__hint whitespace-normal">
        Les exports reprennent les éditions enregistrées, pas la sélection en cours.
      </span>
    </>
  );
}

/** Bouton de capture de la vue courante — partagé par les panneaux Export spatiaux. */
export function CaptureViewButton({ onCapture }: { onCapture: () => void }) {
  const t = useT();
  return (
    <Button size="sm" variant="ghost" onClick={onCapture} title={t('review.export.capture')}>
      <Camera size={13} />
      {t('review.export.captureShort')}
    </Button>
  );
}
