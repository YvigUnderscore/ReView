import type { SplatTransform } from '../../reviewTypes';
import type { GizmoSettings, GizmoTargetKind } from '../editor/gizmos/gizmoSettings';
import { eulerDegToQuat, quatToEulerDeg } from './transformMath';
import { HudGroup } from './ViewerHud';

/** Arrondi d'affichage (3 décimales) — évite le bruit flottant dans les champs. */
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * Champ numérique « DCC » : non contrôlé pendant la saisie (commit au blur/Entrée), resynchronisé
 * quand la valeur externe change (drag du gizmo) via la clé de remontage — pas de setState en effet.
 */
function NumField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const text = fmt(value);
  return (
    <input
      key={text}
      type="number"
      step="any"
      defaultValue={text}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v) && fmt(v) !== text) onCommit(v);
      }}
      className="w-16 rounded border border-border bg-background/60 px-1 py-0.5 text-right font-mono text-[11px] text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

/** Champ de snap : vide = libre (null), sinon pas d'accrochage strictement positif. */
function SnapField({
  title,
  value,
  onCommit,
}: {
  title: string;
  value: number | null;
  onCommit: (v: number | null) => void;
}) {
  const text = value != null ? fmt(value) : '';
  return (
    <input
      key={text}
      type="number"
      step="any"
      min={0}
      placeholder="—"
      defaultValue={text}
      title={title}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const raw = e.currentTarget.value.trim();
        const v = Number(raw);
        onCommit(raw === '' || !Number.isFinite(v) || v <= 0 ? null : v);
      }}
      className="w-12 rounded border border-border bg-background/60 px-1 py-0.5 text-right font-mono text-[11px] text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

function Vec3Row({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: [number, number, number];
  onCommit: (next: [number, number, number]) => void;
}) {
  const set = (i: number) => (v: number) => {
    const next: [number, number, number] = [...value];
    next[i] = v;
    onCommit(next);
  };
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      {value.map((v, i) => (
        <NumField key={i} value={v} onCommit={set(i)} />
      ))}
    </>
  );
}

/**
 * Champs numériques TRS du HUD (10.G-V4) : position, rotation en degrés (euler XYZ) et échelle
 * de la **cible du gizmo** (splat entier ou volume SDF actif). Two-way : un drag du gizmo met
 * à jour les champs ; une saisie applique la TRS à l'objet (commit au blur/Entrée).
 * Contextualisation (11.G) : sphère → un seul champ « Rayon » (le rayon SDF effectif) ;
 * boîte → « Demi-ext. » ; réglages espace/snap/taille du gizmo mémorisés par type de cible.
 */
export default function TransformFields({
  label,
  shape,
  value,
  onCommit,
  gizmo,
}: {
  /** Cible affichée (« Splat », « Boîte 2 »…). */
  label: string;
  /** Forme du volume actif (null = splat entier) — pilote le champ d'échelle. */
  shape: 'box' | 'sphere' | null;
  value: SplatTransform;
  onCommit: (t: SplatTransform) => void;
  /** Réglages du gizmo pour la cible courante (11.G). */
  gizmo: {
    kind: GizmoTargetKind;
    settings: GizmoSettings;
    update: (patch: Partial<GizmoSettings>) => void;
  };
}) {
  const s = gizmo.settings;
  const radius = (Math.abs(value.scale[0]) + Math.abs(value.scale[1]) + Math.abs(value.scale[2])) / 3;
  return (
    <HudGroup>
      <span className="font-medium text-foreground">{label}</span>
      <div className="grid grid-cols-[auto_repeat(3,auto)] items-center gap-x-1.5 gap-y-1">
        <Vec3Row
          label="Position"
          value={value.position}
          onCommit={(position) => onCommit({ ...value, position })}
        />
        <Vec3Row
          label="Rotation °"
          value={quatToEulerDeg(value.quaternion)}
          onCommit={(deg) => onCommit({ ...value, quaternion: eulerDegToQuat(deg) })}
        />
        {shape === 'sphere' ? (
          <>
            <span className="text-muted-foreground" title="Rayon effectif du volume SDF (11.F)">
              Rayon
            </span>
            <NumField
              value={radius}
              onCommit={(r) => {
                const v = Math.max(r, 0.001);
                onCommit({ ...value, scale: [v, v, v] });
              }}
            />
            <span />
            <span />
          </>
        ) : (
          <Vec3Row
            label={shape === 'box' ? 'Demi-ext.' : 'Échelle'}
            value={value.scale}
            onCommit={(scale) =>
              onCommit({ ...value, scale: scale.map((x) => Math.max(x, 0.001)) as [number, number, number] })
            }
          />
        )}
      </div>
      {/* Réglages du gizmo, mémorisés par type de cible (splat / volume) — 11.G. */}
      <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-1.5 text-[11px]">
        <button
          onClick={() => gizmo.update({ space: s.space === 'local' ? 'world' : 'local' })}
          title="Espace de manipulation du gizmo (local à la cible / monde)"
          className="rounded border border-border px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {s.space === 'local' ? 'Local' : 'Monde'}
        </button>
        <span className="text-muted-foreground">Snap</span>
        <SnapField
          title="Pas d'accrochage en translation (unités scène) — vide : libre"
          value={s.translationSnap}
          onCommit={(translationSnap) => gizmo.update({ translationSnap })}
        />
        <SnapField
          title="Pas d'accrochage en rotation (degrés) — vide : libre"
          value={s.rotationSnapDeg}
          onCommit={(rotationSnapDeg) => gizmo.update({ rotationSnapDeg })}
        />
        <SnapField
          title="Pas d'accrochage en échelle (facteur) — vide : libre"
          value={s.scaleSnap}
          onCommit={(scaleSnap) => gizmo.update({ scaleSnap })}
        />
        <label
          className="ml-auto flex items-center gap-1 text-muted-foreground"
          title="Taille des poignées du gizmo pour cette cible"
        >
          Taille
          <input
            type="range"
            min={0.4}
            max={2}
            step={0.05}
            value={s.size}
            onChange={(e) => gizmo.update({ size: Number(e.target.value) })}
            className="h-1 w-14 accent-primary"
          />
        </label>
      </div>
    </HudGroup>
  );
}
