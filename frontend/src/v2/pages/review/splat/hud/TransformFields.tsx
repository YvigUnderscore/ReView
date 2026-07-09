import type { SplatTransform } from '../../reviewTypes';
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
 */
export default function TransformFields({
  label,
  value,
  onCommit,
}: {
  /** Cible affichée (« Splat », « Boîte 2 »…). */
  label: string;
  value: SplatTransform;
  onCommit: (t: SplatTransform) => void;
}) {
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
        <Vec3Row
          label="Échelle"
          value={value.scale}
          onCommit={(scale) =>
            onCommit({ ...value, scale: scale.map((s) => Math.max(s, 0.001)) as [number, number, number] })
          }
        />
      </div>
    </HudGroup>
  );
}
