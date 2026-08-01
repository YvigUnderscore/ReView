import type { ReactNode } from 'react';
import { Camera, FileArchive, FileDown, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Group } from '../chrome/DockGroup';

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
  return (
    <>
      <Group title="Média">
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
            title="Télécharger le fichier original, sans édition"
          >
            <FileDown size={13} />
            Fichier original, sans édition
          </a>
        </Button>
      </Group>
      {staging && <Group title="Mise en scène">{staging}</Group>}
      <span className="rv-optbar__hint whitespace-normal">
        Les exports reprennent les éditions enregistrées, pas la sélection en cours.
      </span>
    </>
  );
}

/** Bouton de capture de la vue courante — partagé par les panneaux Export spatiaux. */
export function CaptureViewButton({ onCapture }: { onCapture: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onCapture} title="Capturer la vue courante en PNG">
      <Camera size={13} />
      Capture de la vue (PNG)
    </Button>
  );
}
