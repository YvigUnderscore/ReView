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
 * Inspector dock content for the splat viewer: one panel at a time. It gathers what used to float in
 * `TopRightControls`, `ViewerSettingsPanel`, `StatsPanel`, `SplatExportPanel`, `CameraBar` and `SectionBar`:
 * same settings, same effect, in a fixed place.
 *
 * The **Display** tab is no longer here (Phase 50, batch 12): rendering settings are taken while looking at
 * the cloud, not at the other end of the screen. The **same** `DisplayPanel` is mounted in the "Rendering"
 * popover of the viewer (`SplatViewerMenus`), as in 3D since batch 6.
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
  /** Camera workshop: the panel's switch drives the **mode** of the chrome, the only entry. */
  staging: { active: boolean; toggle: () => void };
  onFrame: () => void;
  onHome: () => void;
  onImportAnim: (file: File) => void;
  /** Manager: orbit preset and clearing of the persisted presentation. */
  canPresent?: boolean;
}) {
  const t = useT();
  const [stats, setStats] = useState<SplatStats | null>(null);
  const [exporting, setExporting] = useState(false);
  const { subscribeStats } = splat;
  // Stats are only measured when the Info panel is open.
  useEffect(() => (panel === 'info' ? subscribeStats(setStats) : undefined), [panel, subscribeStats]);

  if (panel === 'camera') {
    // Focal length / tilt reflect the value **sampled** at the current time when the channel is animated.
    // The panel and the animation no longer drift silently; with auto-key armed, modifying them sets a
    // `fov` / `roll` key at the playhead.
    const anim = pres.anim;
    const fovNow = anim.anim.channels.fov
      ? evalChannel(anim.anim.channels.fov, anim.timeMs, pres.rig.fov)
      : pres.rig.fov;
    const rollNow = anim.anim.channels.roll
      ? evalChannel(anim.anim.channels.roll, anim.timeMs, pres.rig.roll)
      : pres.rig.roll;
    // Review frame: this panel only SAYS it. Its ratio comes from the pipeline settings, except for a media
    // whose presentation has already frozen the aspect (`reviewAspect`).
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
