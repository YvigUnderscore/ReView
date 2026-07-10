import { Paintbrush, Undo2, X } from 'lucide-react';
import { HudGroup, HudIconButton } from '../hud/ViewerHud';
import type { SplatPaintState } from './useSplatPaint';

/** Couleurs de trait proposées (données d'annotation, pas des tokens de thème). */
const COLORS = ['#ff4d4d', '#ffb020', '#3ddc68', '#38b6ff'];

/**
 * Barre du painter 3D (10.G-V9) : activer la peinture de surface, couleur, épaisseur,
 * annuler/effacer les traits du commentaire en cours. Les traits partent avec le prochain
 * commentaire (composer) et restent visibles pour tous une fois envoyés.
 */
export default function PaintBar({ paint }: { paint: SplatPaintState }) {
  return (
    <HudGroup>
      <HudIconButton
        icon={Paintbrush}
        hint="Peindre sur la surface — les traits sont joints au prochain commentaire"
        active={paint.active}
        onClick={() => paint.setActive(!paint.active)}
      />
      {paint.active && (
        <>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => paint.setColor(c)}
              title="Couleur du trait"
              aria-pressed={paint.color === c}
              className={`h-4 w-4 rounded-full border ${
                paint.color === c ? 'border-foreground' : 'border-border'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <label className="flex items-center gap-1 text-muted-foreground" title="Épaisseur du trait">
            <input
              type="range"
              min={1}
              max={5}
              value={paint.width}
              onChange={(e) => paint.setWidth(Number(e.target.value))}
              className="h-1 w-12 accent-primary"
            />
          </label>
        </>
      )}
      {paint.pendingCount > 0 && (
        <>
          <span className="text-muted-foreground">
            <span className="font-mono text-foreground">{paint.pendingCount}</span> trait
            {paint.pendingCount > 1 ? 's' : ''} à envoyer
          </span>
          <button
            onClick={paint.undoStroke}
            title="Annuler le dernier trait"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Undo2 size={12} />
          </button>
          <button
            onClick={paint.clearPending}
            title="Effacer tous les traits non envoyés"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={12} />
          </button>
        </>
      )}
    </HudGroup>
  );
}
