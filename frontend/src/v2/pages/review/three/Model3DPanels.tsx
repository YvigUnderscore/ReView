// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Download, Upload } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { PanelId } from '../chrome/panels';
import CameraPanel from '../panels/CameraPanel';
import ExportPanel, { CaptureViewButton } from '../panels/ExportPanel';
import LightingPanel from '../panels/LightingPanel';
import Model3DInfo from './Model3DInfo';
import Model3DPerfGroup from './Model3DPerfGroup';
import ScenePanel from '../panels/ScenePanel';
import ScenegraphPanel from '../panels/ScenegraphPanel';
import { focalToFov, fovToFocal } from '../camera/focal';
import { shouldKeyLens } from '../camera/shotCamera';
import { evalChannel } from '../camera/channels/hermite';
import { confirmClearPresentation } from '../camera/confirmReplaceAnim';
import { mediaReviewAspect, reviewAspectLabel } from '../reviewAspect';
import type { MediaResp } from '../reviewTypes';
import { downloadAnimGltf } from './exportCameraGltf';
import type { Model3DBookmarksState } from './useModel3DBookmarks';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DLightingState } from './useModel3DLighting';
import type { Model3DThreeState } from './useModel3DThree';
import type { ModelMeasureState } from './useModelMeasure';
import type { SectionPlaneState } from './useSectionPlane';
import type { TurntableState } from './useTurntable';
import type { UsdSceneState } from './useUsdScene';
import type { CameraAnimState } from '../camera/useCameraAnim';
import { useT } from '../../../i18n';

const RAD = Math.PI / 180;

/**
 * Contenu du dock inspecteur pour le viewer 3D. Rassemble ce qui flottait dans `InspectBar`,
 * `Model3DVariantsBar`, `LightingBar`, `BookmarksBar`, `TurntableBar`, `SectionBar`,
 * `ModelInfoPanel` et `CameraBar`. Cinq onglets depuis la Phase 50 : « Affichage » est passé
 * en popover au coin haut-gauche du viewer (`Model3DRenderMenu`), là où l'on essaie un mode de
 * rendu en regardant le modèle. L'onglet Infos vit dans `Model3DInfo` : c'est le seul dont le
 * contenu ne tient pas en quelques lignes ici.
 */
export default function Model3DPanels({
  panel,
  data,
  m,
  anim,
  lighting,
  inspect,
  staging,
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
  /**
   * Mise en scène — l'interrupteur du panneau Caméra EST son entrée depuis la Phase 50 :
   * la bascule de mode ne porte plus de segment « Mise en scène », qui ne faisait qu'allumer
   * le layout que cet interrupteur allumait déjà. Il arme donc le mode entier (vue PiP,
   * caméra-objet, outils caméra au rail, bouton « Publier » en barre d'options).
   */
  staging: { active: boolean; toggle: () => void };
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
    // Focale/tilt reflètent la valeur échantillonnée au temps courant quand le canal est animé.
    // Les modifier pose une clé `fov`/`roll` au playhead dès qu'on est hors caméra — sans quoi le
    // panneau affichait la valeur du plan et écrivait sur la caméra libre (cf. `shouldKeyLens`).
    const fovNow = anim.anim.channels.fov ? evalChannel(anim.anim.channels.fov, anim.timeMs, m.fov) : m.fov;
    const rollNow = anim.anim.channels.roll
      ? evalChannel(anim.anim.channels.roll, anim.timeMs, m.roll)
      : m.roll;
    // Cadre de review : ce panneau ne fait que le DIRE — son ratio vient des réglages pipeline,
    // sauf pour un média dont une présentation a déjà gelé l'aspect (`reviewAspect`).
    const frame = mediaReviewAspect(data);
    return (
      <CameraPanel
        focalMm={Math.round(fovToFocal(fovNow))}
        onFocalMm={(mm) => {
          const fov = focalToFov(Math.min(Math.max(mm, 7), 400));
          m.setFov(fov);
          if (shouldKeyLens(m.layoutMode, anim.autoKey)) anim.addKey('fov', anim.timeMs, fov);
        }}
        tiltDeg={Math.round(rollNow / RAD)}
        onTiltDeg={(deg) => {
          m.setRoll(deg * RAD);
          if (shouldKeyLens(m.layoutMode, anim.autoKey)) anim.addKey('roll', anim.timeMs, deg * RAD);
        }}
        layout={{
          active: staging.active,
          onToggle: staging.toggle,
          // Nommé par le mode qu'il arme, pas par la fenêtre qu'il ouvre.
          label: t('mode.stage'),
          hint: t('mode.stage.hint'),
          onOrbit,
          onClear: onClearPresentation ? () => confirmClearPresentation(onClearPresentation) : undefined,
        }}
        aspect={{ label: reviewAspectLabel(frame.value), frozen: frame.frozen }}
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
            <CaptureViewButton capture={m.captureView} originalName={data.media.originalName} />
          </>
        }
      />
    );

  return null;
}
