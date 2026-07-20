import { Download, Gauge, Grid3x3, Maximize, Move3d, Rotate3d, Settings2 } from 'lucide-react';
import { useState } from 'react';
import type { SplatViewer } from '../useSplat';
import type { PresentationState } from '../presentation/usePresentation';
import type { ExportEdits } from '../export/exportSplat';
import { useCameraSceneRig } from '../../camera/sceneRig/useCameraSceneRig';
import { HudGroup, HudIconButton } from '../../hud/ViewerHud';
import StatsPanel from './StatsPanel';
import ViewerSettingsPanel from './ViewerSettingsPanel';
import SplatExportPanel from './SplatExportPanel';

/**
 * Coin haut-droit du HUD splat : caméra-objet du mode layout (Phase 27), stats de rendu,
 * réglages du viewer (culling, debug, reveal, LOD), grille de sol et plein écran. Extrait de
 * `SplatReview` (budget de taille) — l'état des panneaux et le rig caméra-objet vivent ici.
 */
export default function TopRightControls({
  splat,
  pres,
  canPresent,
  grid,
  onFullscreen,
  exportData,
}: {
  splat: SplatViewer;
  pres: PresentationState;
  /** Gestionnaire : peut éditer les clés de la caméra-objet (gizmo). */
  canPresent: boolean;
  grid: { visible: boolean; toggle: () => void };
  onFullscreen: () => void;
  /** Données d'export du splat (41.A/C) : éditions effectives + nom/URL de l'original. */
  exportData: { edits: ExportEdits; originalName: string; originalUrl: string };
}) {
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [cullingOff, setCullingOffState] = useState(true);
  const onCullingOff = (off: boolean) => {
    setCullingOffState(off);
    splat.setCullingOff(off);
  };

  // Caméra-objet dans la scène (mode layout, Phase 27) : mesh + trajectoire + gizmo des clés.
  const rig = useCameraSceneRig({
    getSceneHandle: splat.getSceneHandle,
    subscribeFrame: splat.subscribeFrame,
    ready: splat.ready,
    active: pres.layout.layoutMode,
    editable: canPresent,
    anim: pres.anim,
  });

  return (
    <>
      {pres.layout.layoutMode && canPresent && (
        <HudGroup>
          <span className="text-muted-foreground">Caméra-objet</span>
          <HudIconButton
            icon={Move3d}
            hint="Déplacer la caméra-objet (pose)"
            active={rig.mode === 'translate'}
            onClick={() => rig.setMode('translate')}
          />
          <HudIconButton
            icon={Rotate3d}
            hint="Orienter la caméra-objet (regard)"
            active={rig.mode === 'rotate'}
            onClick={() => rig.setMode('rotate')}
          />
        </HudGroup>
      )}
      <HudGroup>
        <HudIconButton
          icon={Gauge}
          hint="Statistiques de rendu (FPS, splats, draw calls)"
          active={showStats}
          onClick={() => setShowStats((v) => !v)}
        />
        <HudIconButton
          icon={Settings2}
          hint="Réglages du viewer (culling…)"
          active={showSettings}
          onClick={() => setShowSettings((v) => !v)}
        />
        <HudIconButton
          icon={Download}
          hint="Exporter le splat (.spz nettoyé) ou télécharger l'original — 41.A/C"
          active={showExport}
          onClick={() => setShowExport((v) => !v)}
        />
        <HudIconButton
          icon={Grid3x3}
          hint="Grille de sol (repère d'orientation de la scène)"
          active={grid.visible}
          onClick={grid.toggle}
        />
        <HudIconButton icon={Maximize} hint="Plein écran" onClick={onFullscreen} />
      </HudGroup>
      {showStats && <StatsPanel splat={splat} />}
      {showExport && (
        <SplatExportPanel
          getSceneHandle={splat.getSceneHandle}
          edits={exportData.edits}
          originalName={exportData.originalName}
          originalUrl={exportData.originalUrl}
        />
      )}
      {showSettings && (
        <ViewerSettingsPanel
          cullingOff={cullingOff}
          onCullingOff={onCullingOff}
          debugMode={pres.debugMode}
          onDebugMode={pres.setDebugMode}
          reveal={pres.reveal}
          onReveal={pres.setReveal}
          onReplayReveal={pres.replayReveal}
          lodMode={pres.lodMode}
          onLodMode={pres.setLodMode}
        />
      )}
    </>
  );
}
