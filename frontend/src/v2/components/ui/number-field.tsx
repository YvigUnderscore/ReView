// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { clampValue, dragValue, formatValue, parseInput, type NumberFieldSpec } from './number-field.math';

/**
 * Champ numérique à libellé draggable — la primitive du chrome de review, promue du HUD 3D
 * (Phase 17). Glisser le libellé horizontalement scrube la valeur (Maj ×10) ; la saisie
 * clavier reste disponible dans l'input. Remplace les sliders : compact, précis, alignable
 * en ligne dans une barre d'options comme dans une ligne de panneau.
 *
 * `pixelsPerStep` vaut 3 par défaut ; passer 6 pour les plages inférieures à 1 (ouverture,
 * gamma, vitesse) afin que le geste reste contrôlable.
 */
export interface NumberFieldProps {
  /** Libellé court ou icône, affiché avant la valeur — c'est lui qu'on glisse. */
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  pixelsPerStep?: number;
  /** Unité affichée après la valeur (`%`, `°`, `×`…). */
  unit?: string;
  /** Infobulle du champ — complétée par le rappel du geste. */
  hint?: string;
  className?: string;
  disabled?: boolean;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  pixelsPerStep = 3,
  unit,
  hint,
  className,
  disabled,
}: NumberFieldProps) {
  const spec: NumberFieldSpec = { min, max, step, pixelsPerStep };
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
  // Pendant la frappe l'input vit sa vie (« -», « 0, », champ vide) ; on ne commet qu'à la sortie.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    const parsed = parseInput(text);
    if (parsed != null) onChange(clampValue(parsed, spec));
    setDraft(null);
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-input bg-background px-1.5 text-xs',
        'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      title={hint ? `${hint} — glisser le libellé pour ajuster (Maj ×10)` : undefined}
    >
      <span
        className="flex touch-none select-none items-center text-muted-foreground [cursor:ew-resize]"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { pointerId: e.pointerId, startX: e.clientX, startValue: value };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.pointerId !== e.pointerId) return;
          onChange(dragValue(d.startValue, e.clientX - d.startX, spec, e.shiftKey ? 10 : 1));
        }}
        onPointerUp={(e) => {
          if (drag.current?.pointerId === e.pointerId) drag.current = null;
        }}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? formatValue(value, step)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          else if (e.key === 'Escape') setDraft(null);
        }}
        className="h-[1.625rem] w-10 border-0 bg-transparent p-0 text-right font-mono text-xs text-foreground outline-none"
      />
      {unit && <span className="font-mono text-[0.625rem] text-muted-foreground">{unit}</span>}
    </span>
  );
}
