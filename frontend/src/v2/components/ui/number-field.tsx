// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import {
  clampValue,
  dragValue,
  formatValue,
  isScrub,
  parseInput,
  scrubOffset,
  type NumberFieldSpec,
} from './number-field.math';

/** Geste en cours — armé au pointerdown, promu en scrub au franchissement du seuil. */
interface Gesture {
  pointerId: number;
  startX: number;
  startValue: number;
  /** Vrai dès que la valeur suit le pointeur ; faux tant que l'appui peut rester un clic. */
  scrubbing: boolean;
  /** Geste parti du champ de saisie (seuil + focus différé) plutôt que du libellé. */
  fromField: boolean;
}

/**
 * Champ numérique scrubable — la primitive du chrome de review, promue du HUD 3D (Phase 17).
 * Glisser horizontalement **la valeur ou le libellé** scrube (Maj ×10, Échap annule) ; un
 * clic net focalise le champ et sélectionne le texte, la saisie clavier reste entière.
 * Remplace les sliders : compact, précis, alignable en ligne dans une barre d'options comme
 * dans une ligne de panneau.
 *
 * `pixelsPerStep` vaut 3 par défaut ; passer 6 pour les plages inférieures à 1 (ouverture,
 * gamma, vitesse) afin que le geste reste contrôlable.
 */
export interface NumberFieldProps {
  /** Libellé court ou icône, affiché avant la valeur — lui aussi se glisse. */
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
  const t = useT();
  const spec: NumberFieldSpec = { min, max, step, pixelsPerStep };
  /*
   * Le libellé visible est un *frère* de l'input — c'est lui qui porte le geste de
   * glissement, il ne peut donc pas l'englober. Sans association, un lecteur d'écran
   * annonce une zone de saisie anonyme. On le rattache par `aria-labelledby` ; quand le
   * libellé est une icône (donc sans texte), `hint` prend le relais.
   */
  const labelId = useId();
  const textLabel = typeof label === 'string';
  const gesture = useRef<Gesture | null>(null);
  // Le scrub est aussi un *état* : c'est lui qui décide d'écouter Échap (voir l'effet).
  const [scrubbing, setScrubbing] = useState(false);
  // Pendant la frappe l'input vit sa vie (« -», « 0, », champ vide) ; on ne commet qu'à la sortie.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    const parsed = parseInput(text);
    if (parsed != null) onChange(clampValue(parsed, spec));
    setDraft(null);
  };

  /** Clôt le geste — relâchement ou pointeur annulé ; ignore un pointeur étranger. */
  const endGesture = (e?: ReactPointerEvent) => {
    if (e && gesture.current?.pointerId !== e.pointerId) return;
    gesture.current = null;
    setScrubbing(false);
  };

  /** Déplacement : arme puis suit le scrub, commun au libellé et au champ. */
  const handleMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    if (!g.scrubbing) {
      if (!isScrub(dx)) return;
      g.scrubbing = true;
      setScrubbing(true);
    }
    // Le seuil n'est retiré que pour le champ : le libellé, lui, scrube dès le premier pixel.
    onChange(dragValue(g.startValue, g.fromField ? scrubOffset(dx) : dx, spec, e.shiftKey ? 10 : 1));
  };

  /*
   * Piège : pendant un scrub sur le champ, le focus est volontairement refusé (le caret et
   * la sélection parasiteraient le geste) — la touche n'atteint donc jamais l'input. C'est
   * la fenêtre qui écoute Échap, et seulement le temps du geste, pour ne pas confisquer la
   * touche au reste de l'application. L'Échap de l'input (abandon du brouillon de saisie)
   * n'entre pas en conflit : un scrub ne s'arme jamais sur un champ déjà en saisie.
   */
  useEffect(() => {
    if (!scrubbing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const g = gesture.current;
      if (e.key !== 'Escape' || !g) return;
      e.preventDefault();
      onChange(g.startValue);
      gesture.current = null;
      setScrubbing(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scrubbing, onChange]);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-input bg-background px-1.5 text-xs',
        'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      title={hint ? t('numberField.scrubHint', { hint }) : undefined}
    >
      {/*
        Le libellé garde son propre rappel (`dragHint`, « glisser le libellé ») : son texte
        reste juste dans les quatorze langues, alors que l'enveloppe annonce désormais le
        geste sur la valeur (`scrubHint`). Réécrire l'ancienne clé aurait rendu faux le
        message de tous les autres appelants.
      */}
      <span
        id={textLabel ? labelId : undefined}
        title={hint ? t('numberField.dragHint', { hint }) : undefined}
        className="flex touch-none select-none items-center text-muted-foreground [cursor:ew-resize]"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Pas de seuil ici : le libellé n'a rien d'autre à faire qu'être glissé.
          gesture.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startValue: value,
            scrubbing: true,
            fromField: false,
          };
          setScrubbing(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={handleMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        aria-labelledby={textLabel ? labelId : undefined}
        aria-label={textLabel ? undefined : hint}
        value={draft ?? formatValue(value, step)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          else if (e.key === 'Escape') setDraft(null);
        }}
        onPointerDown={(e) => {
          // Champ déjà en saisie : on rend la main au caret et à la sélection de texte
          // natifs — sinon on ne pourrait plus corriger un chiffre au milieu d'un nombre.
          if (e.button !== 0 || document.activeElement === e.currentTarget) return;
          // Le focus est refusé tant qu'on ne sait pas si l'appui est un clic ou un scrub :
          // annuler le pointerdown supprime les événements souris de compatibilité, donc
          // la focalisation. Le clic net le rendra lui-même au relâchement.
          e.preventDefault();
          gesture.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startValue: value,
            scrubbing: false,
            fromField: true,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={handleMove}
        onPointerUp={(e) => {
          const g = gesture.current;
          if (!g || g.pointerId !== e.pointerId) return;
          const field = e.currentTarget;
          endGesture();
          // Sous le seuil : c'était un clic. On focalise, `onFocus` sélectionne la valeur.
          if (!g.scrubbing) field.focus();
        }}
        onPointerCancel={endGesture}
        className={cn(
          'h-[1.625rem] w-10 touch-none border-0 bg-transparent p-0 text-right font-mono text-xs',
          'text-foreground outline-none',
          // Le curseur dit ce que le champ fait : scrubable au survol, textuel en saisie.
          '[cursor:ew-resize] focus:[cursor:text]',
        )}
      />
      {unit && <span className="font-mono text-[0.625rem] text-muted-foreground">{unit}</span>}
    </span>
  );
}
