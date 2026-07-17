import {
  Diamond,
  Download,
  KeyRound,
  MessageSquarePlus,
  Orbit,
  Pause,
  Play,
  Redo2,
  Repeat,
  Save,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { HudIconButton } from '../../hud/ViewerHud';
import HudNumber from '../../hud/HudNumber';
import type { CameraAnimState } from '../useCameraAnim';

/**
 * Barre d'outils de l'éditeur d'animation caméra (Phase 17/27) : transport (play/pause, boucle,
 * temps), pose de clé, **auto-key**, **durée de lecture réglable**, preset orbite, import/export
 * glTF, undo/redo, et — pour le gestionnaire — joindre au commentaire + enregistrer/effacer la
 * présentation. Le dopesheet a été retiré (graph editor unique, Phase 27).
 */
export default function AnimToolbar({
  anim,
  onOrbitPreset,
  onImport,
  onExport,
  onAttach,
  onSave,
  onClear,
  busy,
  editable,
}: {
  anim: CameraAnimState;
  onOrbitPreset: (radiusScale?: number) => void;
  onImport?: (file: File) => void;
  onExport: () => void;
  onAttach?: () => void;
  onSave?: () => void;
  onClear?: () => void;
  busy?: boolean;
  editable: boolean;
}) {
  const has = anim.hasAnimation;
  const [orbitScale, setOrbitScale] = useState(1);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-medium text-foreground">Animation</span>
      <HudIconButton
        icon={anim.playing ? Pause : Play}
        hint={anim.playing ? 'Pause' : 'Lire'}
        active={anim.playing}
        onClick={anim.playing ? anim.pause : anim.play}
        disabled={!has}
      />
      <HudIconButton
        icon={Repeat}
        hint="Lire en boucle"
        active={anim.loop}
        onClick={() => anim.setLoop(!anim.loop)}
      />
      <span className="min-w-12 font-mono text-[11px] text-muted-foreground">
        {(anim.timeMs / 1000).toFixed(2)}s
      </span>
      {editable && (
        <>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={() => anim.insertKeyAtView()}
            title="Poser une clé depuis la vue courante (au temps de lecture)"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <Diamond size={12} /> Clé
          </button>
          <HudIconButton
            icon={KeyRound}
            hint="Auto-key : tout geste caméra pose une clé au temps de lecture"
            active={anim.autoKey}
            onClick={() => anim.setAutoKey(!anim.autoKey)}
          />
          <HudNumber
            label="Durée"
            hint="Durée de lecture (s) — 0 = automatique (dernière clé). Guide dans le graphe."
            value={Number((anim.playDuration / 1000).toFixed(2))}
            onChange={(s) => anim.setDuration(s > 0 ? Math.round(s * 1000) : undefined)}
            min={0}
            max={600}
            step={0.5}
            unit="s"
          />
          <HudIconButton
            icon={Orbit}
            hint="Preset : orbite complète autour de la cible courante (centre = cible cadrée)"
            onClick={() => onOrbitPreset(orbitScale)}
          />
          <HudNumber
            label="Dist."
            hint="Distance d'orbite — multiplie le rayon caméra↔centre courant"
            value={orbitScale}
            onChange={setOrbitScale}
            min={0.25}
            max={4}
            step={0.05}
            pixelsPerStep={6}
            unit="×"
          />
          <HudIconButton icon={Undo2} hint="Annuler" onClick={anim.undo} disabled={!anim.canUndo} />
          <HudIconButton icon={Redo2} hint="Rétablir" onClick={anim.redo} disabled={!anim.canRedo} />
        </>
      )}
      {onImport && editable && (
        <label
          title="Importer une animation caméra depuis un glTF (d'un logiciel 3D)"
          className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <Upload size={12} /> Import
          <input
            type="file"
            accept=".gltf,.glb,model/gltf+json,model/gltf-binary"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {has && <HudIconButton icon={Download} hint="Exporter l'animation caméra (glTF)" onClick={onExport} />}
      {onAttach && has && (
        <button
          onClick={onAttach}
          title="Joindre cette animation au prochain commentaire (mode layout)"
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <MessageSquarePlus size={12} /> Joindre
        </button>
      )}
      {onSave && (
        <>
          <span className="h-4 w-px bg-border" />
          <button
            onClick={onSave}
            disabled={busy}
            title="Enregistrer la présentation (caméra + animation) — rejouée pour tous à l'ouverture"
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-50"
          >
            <Save size={12} /> Présentation
          </button>
          {onClear && (
            <HudIconButton
              icon={Trash2}
              hint="Effacer la présentation persistée"
              onClick={onClear}
              disabled={busy}
            />
          )}
        </>
      )}
    </div>
  );
}
