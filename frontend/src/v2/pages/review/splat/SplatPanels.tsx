// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Download, Upload } from 'lucide-react';
import type { PanelId } from '../chrome/panels';
import CameraPanel from '../panels/CameraPanel';
import DisplayPanel from '../panels/DisplayPanel';
import ExportPanel, { CaptureViewButton } from '../panels/ExportPanel';
import InfoPanel, { type InfoRow } from '../panels/InfoPanel';
import ScenePanel from '../panels/ScenePanel';
import { focalToFov, fovToFocal } from '../camera/focal';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import type { MediaResp } from '../reviewTypes';
import type { SplatEditorState } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import type { SplatStats } from './scene/stats';
import type { SplatViewer } from './useSplat';
import type { SplatCompareState } from './compare/useSplatCompare';
import { buildCleanSpz, cleanExportName, downloadBytes, type ExportEdits } from './export/exportSplat';
import { downloadAnimGltf } from '../three/exportCameraGltf';
import { useT } from '../../../i18n';
import { intlLocale } from '../../../i18n';

const RAD = Math.PI / 180;
const fmt = (n: number) => Math.round(n).toLocaleString(intlLocale());

/** Taille lisible pour le toast d'export (Ko/Mo). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Aspect du cadre de livraison, en texte — hérité des réglages pipeline, non modifiable ici. */
function aspectLabel(aspect: number | undefined): string {
  const a = aspect ?? DEFAULT_REVIEW_ASPECT;
  const known: [number, string][] = [
    [16 / 9, '16:9'],
    [2.39, '2.39:1'],
    [1.85, '1.85:1'],
    [4 / 3, '4:3'],
    [1, '1:1'],
  ];
  return known.find(([v]) => Math.abs(v - a) < 0.01)?.[1] ?? `${a.toFixed(2)}:1`;
}

/**
 * Contenu du dock inspecteur pour le viewer splat : un panneau à la fois. Rassemble ce qui
 * flottait dans `TopRightControls`, `ViewerSettingsPanel`, `StatsPanel`, `SplatExportPanel`,
 * `CameraBar` et `SectionBar` — mêmes réglages, même effet, à un endroit fixe.
 */
export default function SplatPanels({
  panel,
  data,
  splat,
  pres,
  editor,
  showEdit,
  compare,
  grid,
  culling,
  exportEdits,
  onFrame,
  onHome,
  onImportAnim,
}: {
  panel: PanelId | null;
  data: MediaResp;
  splat: SplatViewer;
  pres: PresentationState;
  editor: SplatEditorState;
  /** Éditeur monté : le mode de rendu et l'orientation ne sont réglables qu'en édition. */
  showEdit: boolean;
  /** Comparaison A/B de la version — porte l'échelle brute des nuages. */
  compare?: SplatCompareState;
  grid: { visible: boolean; toggle: () => void };
  culling: { off: boolean; onOff: (off: boolean) => void };
  exportEdits: ExportEdits;
  onFrame: () => void;
  onHome: () => void;
  onImportAnim: (file: File) => void;
}) {
  const t = useT();
  const [stats, setStats] = useState<SplatStats | null>(null);
  const [exporting, setExporting] = useState(false);
  const { subscribeStats } = splat;
  // Les stats ne sont mesurées que lorsque le panneau Infos est ouvert.
  useEffect(() => (panel === 'info' ? subscribeStats(setStats) : undefined), [panel, subscribeStats]);

  if (panel === 'camera')
    return (
      <CameraPanel
        focalMm={Math.round(fovToFocal(pres.rig.fov))}
        onFocalMm={(mm) => pres.rig.setFov(focalToFov(Math.min(Math.max(mm, 7), 400)))}
        tiltDeg={Math.round(pres.rig.roll / RAD)}
        onTiltDeg={(deg) => pres.rig.setRoll(deg * RAD)}
        dof={{
          aperture: pres.rig.aperture,
          onAperture: pres.rig.setAperture,
          focusPick: pres.rig.focusPick,
          onToggleFocusPick: pres.rig.toggleFocusPick,
        }}
        layout={{
          active: pres.layout.layoutMode,
          onToggle: () => pres.layout.setLayoutMode(!pres.layout.layoutMode),
        }}
        aspectLabel={aspectLabel(data.splatPresentation?.camera?.aspect)}
        onFrame={onFrame}
        onHome={onHome}
      />
    );

  if (panel === 'display')
    return (
      <DisplayPanel
        // Le mode de rendu et l'orientation sont des éditions : réservés à l'éditeur monté.
        splat={
          showEdit
            ? {
                mode: editor.renderMode,
                onMode: editor.setRenderMode,
                baseFlip: editor.baseFlip,
                onBaseFlip: () => editor.toggleBaseFlip(),
              }
            : undefined
        }
        realSize={
          compare?.enabled ? { value: !compare.normalized, onChange: compare.toggleNormalized } : undefined
        }
        debugMode={pres.debugMode}
        onDebugMode={pres.setDebugMode}
      />
    );

  if (panel === 'scene')
    return (
      <ScenePanel
        grid={{ visible: grid.visible, onToggle: grid.toggle }}
        perf={{
          lod: { mode: pres.lodMode, onMode: pres.setLodMode },
          culling: { off: culling.off, onOff: culling.onOff },
          reveal: {
            config: pres.reveal,
            onConfig: pres.setReveal,
            onReplay: pres.replayReveal,
          },
        }}
      />
    );

  if (panel === 'info') {
    const live: InfoRow[] = stats
      ? [
          { label: 'Images/s', value: fmt(stats.fps) },
          { label: 'Splats rendus', value: fmt(stats.activeSplats) },
          { label: 'Splats totaux', value: fmt(stats.totalSplats) },
          { label: t('review.splat.hidden'), value: fmt(editor.deletedCount) },
          { label: 'Draw calls', value: fmt(stats.calls) },
        ]
      : [{ label: 'Mesure…', value: '—' }];
    return (
      <InfoPanel
        live={live}
        sheet={[
          { label: t('review.file'), value: data.media.originalName },
          { label: t('common.status'), value: data.media.status },
        ]}
      />
    );
  }

  if (panel === 'export')
    return (
      <ExportPanel
        cleaned={{
          label: t('review.splat.cleanExport'),
          hint: t('splat.exportHint'),
          busy: exporting,
          onExport: () => {
            const handle = splat.getSceneHandle();
            if (!handle) {
              toast.error(t('review.splat.notLoaded'));
              return;
            }
            setExporting(true);
            void buildCleanSpz(handle, exportEdits)
              .then(({ bytes, kept }) => {
                downloadBytes(bytes, cleanExportName(data.media.originalName));
                toast.success(
                  `Splat exporté : ${kept.toLocaleString(intlLocale())} splats, ${formatBytes(bytes.byteLength)}`,
                );
              })
              .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Échec de l'export"))
              .finally(() => setExporting(false));
          },
        }}
        originalUrl={data.url}
        originalName={data.media.originalName}
        staging={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!pres.anim.hasAnimation}
              onClick={() => void downloadAnimGltf(pres.anim.anim)}
            >
              <Download size={13} />
              {t('review.cameraAnimGltf')}
            </Button>
            <label
              title={t('review.camera.import')}
              className="flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <Upload size={13} />
              {t('review.importAnimation')}
              <input
                type="file"
                accept=".gltf,.glb,.json,model/gltf+json,model/gltf-binary,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportAnim(f);
                  e.target.value = '';
                }}
              />
            </label>
            <CaptureViewButton
              onCapture={() => {
                void splat.captureThumbnail().then((url) => {
                  if (!url) {
                    toast.error('Capture impossible');
                    return;
                  }
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${data.media.originalName.replace(/\.[^.]+$/, '')}.jpg`;
                  a.click();
                  toast.success(t('review.viewCaptured'));
                });
              }}
            />
          </>
        }
      />
    );

  return null;
}
