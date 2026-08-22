// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Camera, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import type { PanelId } from '../chrome/panels';
import CameraPanel from '../panels/CameraPanel';
import DisplayPanel from '../panels/DisplayPanel';
import ExportPanel from '../panels/ExportPanel';
import LightingPanel from '../panels/LightingPanel';
import Model3DInfo from './Model3DInfo';
import Model3DPerfGroup from './Model3DPerfGroup';
import ScenePanel from '../panels/ScenePanel';
import ScenegraphPanel from '../panels/ScenegraphPanel';
import { focalToFov, fovToFocal } from '../camera/focal';
import { evalChannel } from '../camera/channels/hermite';
import { confirmClearPresentation } from '../camera/confirmReplaceAnim';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import type { MediaResp } from '../reviewTypes';
import { downloadAnimGltf } from './exportCameraGltf';
import type { Model3DBookmarksState } from './useModel3DBookmarks';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DLightingState } from './useModel3DLighting';
import type { Model3DThreeState } from './useModel3DThree';
import type { Model3DVariantsState } from './useModel3DVariants';
import type { ModelMeasureState } from './useModelMeasure';
import type { SectionPlaneState } from './useSectionPlane';
import type { TurntableState } from './useTurntable';
import type { UsdSceneState } from './useUsdScene';
import type { CameraAnimState } from '../camera/useCameraAnim';
import { useT } from '../../../i18n';

const RAD = Math.PI / 180;

/** Aspect du cadre de livraison, en texte — hérité des réglages pipeline. */
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
 * Contenu du dock inspecteur pour le viewer 3D. Rassemble ce qui flottait dans `InspectBar`,
 * `Model3DVariantsBar`, `LightingBar`, `BookmarksBar`, `TurntableBar`, `SectionBar`,
 * `ModelInfoPanel` et `CameraBar` — même contenu, six onglets fixes. L'onglet Infos vit dans
 * `Model3DInfo` : c'est le seul dont le contenu ne tient pas en quelques lignes ici.
 */
export default function Model3DPanels({
  panel,
  data,
  m,
  anim,
  lighting,
  inspect,
  variants,
  bookmarks,
  turntable,
  section,
  grid,
  measure,
  scene,
  onSaveOverride,
  savingOverride,
  onRecompose,
  onImportAnim,
  onOrbit,
  onClearPresentation,
}: {
  panel: PanelId | null;
  data: MediaResp;
  m: Model3DThreeState;
  anim: CameraAnimState;
  lighting: Model3DLightingState;
  inspect: Model3DInspectState;
  variants: Model3DVariantsState;
  bookmarks: Model3DBookmarksState;
  turntable: TurntableState;
  section: SectionPlaneState;
  grid: { visible: boolean; toggle: () => void };
  /** Dimensions réelles et outil de mesure (39.G) — affichés dans l'onglet Infos. */
  measure: ModelMeasureState;
  /** Scenegraph USD + override (46.C), absent si le media n'est pas une scene USD. */
  scene?: UsdSceneState;
  /** Enregistre l'override de base — absent apres publication ou sans droits (46.D). */
  onSaveOverride?: () => void;
  savingOverride?: boolean;
  /** Recomposition USD — gestionnaire, média non publié, source USD présente. */
  onRecompose?: () => void;
  onImportAnim?: (file: File) => void;
  /** Preset orbite (gestionnaire). */
  onOrbit?: () => void;
  /** Efface la présentation persistée (gestionnaire — confirmée ici). */
  onClearPresentation?: () => void;
}) {
  const t = useT();
  if (panel === 'camera') {
    const saved = data.splatPresentation?.bookmarks ?? [];
    // Focale/tilt reflètent la valeur échantillonnée au temps courant quand le canal est animé ;
    // avec l'auto-key armé, les modifier pose une clé `fov`/`roll` au playhead.
    const fovNow = anim.anim.channels.fov ? evalChannel(anim.anim.channels.fov, anim.timeMs, m.fov) : m.fov;
    const rollNow = anim.anim.channels.roll
      ? evalChannel(anim.anim.channels.roll, anim.timeMs, m.roll)
      : m.roll;
    return (
      <CameraPanel
        focalMm={Math.round(fovToFocal(fovNow))}
        onFocalMm={(mm) => {
          const fov = focalToFov(Math.min(Math.max(mm, 7), 400));
          m.setFov(fov);
          if (anim.autoKey) anim.addKey('fov', anim.timeMs, fov);
        }}
        tiltDeg={Math.round(rollNow / RAD)}
        onTiltDeg={(deg) => {
          m.setRoll(deg * RAD);
          if (anim.autoKey) anim.addKey('roll', anim.timeMs, deg * RAD);
        }}
        layout={{
          active: m.layoutMode,
          onToggle: () => m.setLayoutMode(!m.layoutMode),
          onOrbit,
          onClear: onClearPresentation ? () => confirmClearPresentation(onClearPresentation) : undefined,
        }}
        aspectLabel={aspectLabel(data.splatPresentation?.camera?.aspect)}
        onFrame={m.frameView}
        onHome={m.homeView}
        bookmarks={{
          items: saved.map((b, i) => ({ id: String(i), label: b.label ?? t('camera.viewN', { n: i + 1 }) })),
          activeId: null,
          onGo: (id) => bookmarks.recall(Number(id)),
          onSave: bookmarks.add && (() => void bookmarks.add?.()),
          onRemove: bookmarks.remove && ((id) => void bookmarks.remove?.(Number(id))),
          busy: bookmarks.busy,
          full: bookmarks.full,
        }}
      />
    );
  }

  if (panel === 'light')
    return (
      <LightingPanel
        lighting={lighting}
        colorDisplay={data.projectColor?.display}
        colorView={data.projectColor?.view}
      />
    );

  if (panel === 'display')
    return (
      <DisplayPanel
        model={{
          mode: inspect.mode,
          onMode: inspect.setMode,
          variants: {
            names: variants.variants,
            active: variants.variants[variants.current] ?? null,
            onSelect: (name) => variants.selectVariant(variants.variants.indexOf(name)),
          },
          cameras: {
            names: variants.cameras.map((c) => c.name),
            active: null,
            onSelect: (name) => variants.goToCamera(variants.cameras.findIndex((c) => c.name === name)),
          },
          skeleton: {
            has: inspect.hasSkeleton,
            shown: inspect.showSkeleton,
            onShow: inspect.setShowSkeleton,
          },
        }}
      />
    );

  if (panel === 'scene')
    return (
      <>
        <ScenePanel
          grid={{ visible: grid.visible, onToggle: grid.toggle }}
          section={{
            active: section.active,
            onActive: section.toggle,
            axis: section.axis,
            onAxis: section.setAxis,
            position: section.position,
            onPosition: section.setPosition,
            flipped: section.flip,
            onFlip: section.toggleFlip,
          }}
          turntable={{
            active: turntable.active,
            onActive: turntable.toggle,
            axis: turntable.axis,
            onAxis: turntable.setAxis,
            speed: turntable.speed,
            onSpeed: turntable.setSpeed,
          }}
          // LOD, culling et effet d'apparition sont propres au splat : le modèle n'en a pas.
          // Ses compteurs de rendu sont dans le groupe qui suit.
          perf={{}}
          // Scenegraph USD (46.C) : l'arbre reel de la scene, au-dessus des reperes de scene.
          scenegraph={
            scene && scene.tree.length > 0 ? (
              <ScenegraphPanel
                scene={scene}
                usd={data.modelSource?.usd ?? null}
                baked={data.modelSource?.blender?.variantsBaked ?? null}
                onRevert={scene.revert}
                onSave={onSaveOverride}
                saving={savingOverride}
              />
            ) : undefined
          }
        />
        <Model3DPerfGroup m={m} textures={inspect.stats?.textures ?? null} />
      </>
    );

  if (panel === 'info')
    return <Model3DInfo data={data} inspect={inspect} measure={measure} m={m} onRecompose={onRecompose} />;

  if (panel === 'export')
    return (
      <ExportPanel
        originalUrl={data.url}
        originalName={data.media.originalName}
        staging={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!anim.hasAnimation}
              onClick={() => void downloadAnimGltf(anim.anim)}
            >
              <Download size={13} />
              {t('review.cameraAnimGltf')}
            </Button>
            {onImportAnim && (
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
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void m.captureThumbnail().then((url) => {
                  if (!url) {
                    toast.error(t('common.error.capture'));
                    return;
                  }
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${data.media.originalName.replace(/\.[^.]+$/, '')}.jpg`;
                  a.click();
                  toast.success(t('review.viewCaptured'));
                });
              }}
            >
              <Camera size={13} />
              {t('review.export.captureShort')}
            </Button>
          </>
        }
      />
    );

  return null;
}
