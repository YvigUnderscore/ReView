import { Camera, Download, Layers, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import type { PanelId } from '../chrome/panels';
import CameraPanel from '../panels/CameraPanel';
import DisplayPanel from '../panels/DisplayPanel';
import ExportPanel from '../panels/ExportPanel';
import InfoPanel, { type InfoRow } from '../panels/InfoPanel';
import LightingPanel from '../panels/LightingPanel';
import ScenePanel from '../panels/ScenePanel';
import ScenegraphPanel from '../panels/ScenegraphPanel';
import { focalToFov, fovToFocal } from '../camera/focal';
import { DEFAULT_REVIEW_ASPECT } from '../frameRect';
import type { MediaResp } from '../reviewTypes';
import { downloadAnimGltf } from './exportCameraGltf';
import type { Model3DBookmarksState } from './useModel3DBookmarks';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DLightingState } from './useModel3DLighting';
import type { Model3DThreeState } from './useModel3DThree';
import type { Model3DVariantsState } from './useModel3DVariants';
import type { SectionPlaneState } from './useSectionPlane';
import type { TurntableState } from './useTurntable';
import type { UsdSceneState } from './useUsdScene';
import type { CameraAnimState } from '../camera/useCameraAnim';

const RAD = Math.PI / 180;
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

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
 * `ModelInfoPanel` et `CameraBar` — même contenu, six onglets fixes.
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
  scene,
  onSaveOverride,
  savingOverride,
  onRecompose,
  onImportAnim,
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
  /** Scenegraph USD + override (46.C), absent si le media n'est pas une scene USD. */
  scene?: UsdSceneState;
  /** Enregistre l'override de base — absent apres publication ou sans droits (46.D). */
  onSaveOverride?: () => void;
  savingOverride?: boolean;
  /** Recomposition USD — gestionnaire, média non publié, source USD présente. */
  onRecompose?: () => void;
  onImportAnim?: (file: File) => void;
}) {
  if (panel === 'camera') {
    const saved = data.splatPresentation?.bookmarks ?? [];
    return (
      <CameraPanel
        focalMm={Math.round(fovToFocal(m.fov))}
        onFocalMm={(mm) => m.setFov(focalToFov(Math.min(Math.max(mm, 7), 400)))}
        tiltDeg={Math.round(m.roll / RAD)}
        onTiltDeg={(deg) => m.setRoll(deg * RAD)}
        layout={{ active: m.layoutMode, onToggle: () => m.setLayoutMode(!m.layoutMode) }}
        aspectLabel={aspectLabel(data.splatPresentation?.camera?.aspect)}
        onFrame={m.frameView}
        onHome={m.homeView}
        bookmarks={{
          items: saved.map((b, i) => ({ id: String(i), label: b.label ?? `Vue ${i + 1}` })),
          activeId: null,
          onGo: (id) => bookmarks.recall(Number(id)),
          onSave: () => void bookmarks.add?.(),
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
    );

  if (panel === 'info') {
    const s = inspect.stats;
    const live: InfoRow[] = s
      ? [
          { label: 'Meshes', value: fmt(s.meshes) },
          { label: 'Triangles', value: fmt(s.triangles) },
          { label: 'Sommets', value: fmt(s.vertices) },
          { label: 'Matériaux', value: fmt(s.materials.length) },
        ]
      : [{ label: 'Mesure…', value: '—' }];
    const sheet: InfoRow[] = [
      { label: 'Fichier', value: data.media.originalName },
      { label: 'Jeux d’UV', value: s?.uvSets.length ? s.uvSets.join(', ') : 'aucun' },
      { label: 'Extensions', value: inspect.extensions.length ? inspect.extensions.join(', ') : 'aucune' },
    ];
    if (data.modelSource?.usd)
      sheet.push({ label: 'Couche racine USD', value: data.modelSource.usd.rootLayer });
    return (
      <InfoPanel
        live={live}
        sheet={sheet}
        action={
          onRecompose && (
            <Button size="sm" variant="outline" onClick={onRecompose}>
              <Layers size={13} />
              Recomposer depuis l’USD
            </Button>
          )
        }
      />
    );
  }

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
              Animation caméra (glTF)
            </Button>
            {onImportAnim && (
              <label
                title="Importer une animation caméra : glTF ou JSON d’échantillons Alembic (.abc)"
                className="flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <Upload size={13} />
                Importer une animation
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
                    toast.error('Capture impossible');
                    return;
                  }
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${data.media.originalName.replace(/\.[^.]+$/, '')}.jpg`;
                  a.click();
                  toast.success('Vue capturée');
                });
              }}
            >
              <Camera size={13} />
              Capture de la vue (PNG)
            </Button>
          </>
        }
      />
    );

  return null;
}
