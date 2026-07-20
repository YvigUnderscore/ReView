import { Download, FileArchive, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { HudGroup } from '../../hud/ViewerHud';
import type { SplatSceneHandle } from '../useSplat';
import { buildCleanSpz, cleanExportName, downloadBytes, type ExportEdits } from '../export/exportSplat';

/** Formatte une taille en octets pour le toast (Ko/Mo). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Panneau d'export du splat (41.A/C) — togglable depuis le HUD haut-droit (le clic droit du
 * viewer sert à la navigation, pas de menu contextuel ici). Deux actions : exporter un **.spz
 * nettoyé** (éditions cuites : masque, crop, transformation — SH degré 0) et télécharger le
 * **fichier original** tel quel. Tout est client : l'objet MinIO n'est jamais modifié.
 */
export default function SplatExportPanel({
  getSceneHandle,
  edits,
  originalName,
  originalUrl,
}: {
  getSceneHandle: () => SplatSceneHandle | null;
  edits: ExportEdits;
  originalName: string;
  originalUrl: string;
}) {
  const [busy, setBusy] = useState(false);

  const exportClean = async () => {
    if (busy) return;
    const handle = getSceneHandle();
    if (!handle) {
      toast.error('Splat non chargé');
      return;
    }
    setBusy(true);
    try {
      const { bytes, kept } = await buildCleanSpz(handle, edits);
      downloadBytes(bytes, cleanExportName(originalName));
      toast.success(
        `Splat exporté : ${kept.toLocaleString('fr-FR')} splats, ${formatBytes(bytes.byteLength)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'export");
    } finally {
      setBusy(false);
    }
  };

  return (
    <HudGroup className="max-w-72">
      <div className="flex w-full flex-col gap-2">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Fichier .spz compact avec les éditions appliquées (masque, crop, transformation). Couleur de base
          (SH degré 0). L’original n’est pas modifié.
        </p>
        <button
          onClick={() => void exportClean()}
          disabled={busy}
          title="Générer un .spz nettoyé (éditions cuites) et le télécharger"
          className="flex items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />}
          Exporter le splat nettoyé (.spz)
        </button>
        <a
          href={originalUrl}
          download={originalName}
          target="_blank"
          rel="noopener noreferrer"
          title="Télécharger le fichier splat original, sans édition"
          className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <Download size={13} /> Télécharger l’original
        </a>
      </div>
    </HudGroup>
  );
}
