// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Download, Upload } from 'lucide-react';
import type { PanelId } from '../chrome/panels';
import CameraPanel from '../panels/CameraPanel';
import ExportPanel, { CaptureViewButton } from '../panels/ExportPanel';
import InfoPanel, { type InfoRow } from '../panels/InfoPanel';
import ScenePanel from '../panels/ScenePanel';
import { focalToFov, fovToFocal } from '../camera/focal';
import { shouldKeyLens } from '../camera/shotCamera';
import { evalChannel } from '../camera/channels/hermite';
import { confirmClearPresentation } from '../camera/confirmReplaceAnim';
import { mediaReviewAspect, reviewAspectLabel } from '../reviewAspect';
import type { MediaResp } from '../reviewTypes';
import type { SplatEditorState } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import type { SplatStats } from './scene/stats';
import type { SplatViewer } from './useSplat';
import { buildCleanSpz, cleanExportName, downloadBytes, type ExportEdits } from './export/exportSplat';
import { downloadAnimGltf } from '../three/exportCameraGltf';
import { useT } from '../../../i18n';
import { formatBytes } from '../../../../lib/formatBytes';
import { intlLocale } from '../../../i18n';

const RAD = Math.PI / 180;
const fmt = (n: number) => Math.round(n).toLocaleString(intlLocale());

/**
 * Contenu du dock inspecteur pour le viewer splat : un panneau à la fois. Rassemble ce qui
 * flottait dans `TopRightControls`, `ViewerSettingsPanel`, `StatsPanel`, `SplatExportPanel`,
 * `CameraBar` et `SectionBar` — mêmes réglages, même effet, à un endroit fixe.
 *
 * L'onglet **Affichage** n'est plus ici (Phase 50, lot 12) : les réglages de rendu se prennent
 * en regardant le nuage, pas à l'autre bout de l'écran. Le **même** `DisplayPanel` est monté
 * dans le popover « Rendu » du viewer (`SplatViewerMenus`), comme en 3D depuis le lot 6.
 */
export default function SplatPanels({
  panel,
  data,
  splat,
  pres,
  editor,
  grid,
  culling,
  exportEdits,
  staging,
  onFrame,
  onHome,
  onImportAnim,
  canPresent,
}: {
  panel: PanelId | null;
  data: MediaResp;
  splat: SplatViewer;
  pres: PresentationState;
  editor: SplatEditorState;
  grid: { visible: boolean; toggle: () => void };
  culling: { off: boolean; onOff: (off: boolean) => void };
  exportEdits: ExportEdits;
  /** Atelier caméra : l'interrupteur du panneau pilote le **mode** du chrome, seule entrée. */
  staging: { active: boolean; toggle: () => void };
  onFrame: () => void;
  onHome: () => void;
  onImportAnim: (file: File) => void;
  /** Gestionnaire : preset orbite et effacement de la présentation persistée. */
  canPresent?: boolean;
}) {
  const t = useT();
  const [stats, setStats] = useState<SplatStats | null>(null);
  const [exporting, setExporting] = useState(false);
  const { subscribeStats } = splat;
  // Les stats ne sont mesurées que lorsque le panneau Infos est ouvert.
  useEffect(() => (panel === 'info' ? subscribeStats(setStats) : undefined), [panel, subscribeStats]);

  if (panel === 'camera') {
    // Focale/tilt reflètent la valeur **échantillonnée** au temps courant quand le canal est
    // animé — le panneau et l'animation ne dérivent plus en silence ; avec l'auto-key armé,
    // les modifier pose une clé `fov`/`roll` au playhead.
    const anim = pres.anim;
    const fovNow = anim.anim.channels.fov
      ? evalChannel(anim.anim.channels.fov, anim.timeMs, pres.rig.fov)
      : pres.rig.fov;
    const rollNow = anim.anim.channels.roll
      ? evalChannel(anim.anim.channels.roll, anim.timeMs, pres.rig.roll)
      : pres.rig.roll;
    // Cadre de review : ce panneau ne fait que le DIRE — son ratio vient des réglages pipeline,
    // sauf pour un média dont une présentation a déjà gelé l'aspect (`reviewAspect`).
    const frame = mediaReviewAspect(data);
    return (
      <CameraPanel
        focalMm={Math.round(fovToFocal(fovNow))}
        onFocalMm={(mm) => {
          const fov = focalToFov(Math.min(Math.max(mm, 7), 400));
          pres.rig.setFov(fov);
          if (shouldKeyLens(staging.active, anim.autoKey)) anim.addKey('fov', anim.timeMs, fov);
        }}
        tiltDeg={Math.round(rollNow / RAD)}
        onTiltDeg={(deg) => {
          pres.rig.setRoll(deg * RAD);
          if (shouldKeyLens(staging.active, anim.autoKey)) anim.addKey('roll', anim.timeMs, deg * RAD);
        }}
        dof={{
          aperture: pres.rig.aperture,
          onAperture: pres.rig.setAperture,
          focusPick: pres.rig.focusPick,
          onToggleFocusPick: pres.rig.toggleFocusPick,
        }}
        layout={{
          active: staging.active,
          onToggle: staging.toggle,
          label: t('mode.stage'),
          hint: t('mode.stage.hint'),
          onOrbit: canPresent ? () => pres.applyOrbitPreset() : undefined,
          onClear:
            canPresent && data.splatPresentation
              ? () => confirmClearPresentation(() => void pres.clear())
              : undefined,
        }}
        aspect={{ label: reviewAspectLabel(frame.value), frozen: frame.frozen }}
        onFrame={onFrame}
        onHome={onHome}
      />
    );
  }

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
          { label: t('stats.fps'), value: fmt(stats.fps) },
          { label: t('splat.rendered'), value: fmt(stats.activeSplats) },
          { label: t('splat.total'), value: fmt(stats.totalSplats) },
          { label: t('review.splat.hidden'), value: fmt(editor.deletedCount) },
          { label: t('stats.drawCalls'), value: fmt(stats.calls) },
        ]
      : [{ label: t('stats.measuring'), value: '—' }];
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
                  t('splat.exported', {
                    value: kept.toLocaleString(intlLocale()),
                    size: formatBytes(bytes.byteLength),
                  }),
                );
              })
              .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('splat.exportFailed')))
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
            <CaptureViewButton capture={splat.captureView} originalName={data.media.originalName} />
          </>
        }
      />
    );

  return null;
}
