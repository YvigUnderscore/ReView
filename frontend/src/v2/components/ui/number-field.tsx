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

/** Gesture in progress: armed on pointerdown, promoted to a scrub once the threshold is crossed. */
interface Gesture {
  pointerId: number;
  startX: number;
  startValue: number;
  /** True once the value follows the pointer; false while the press can still be a click. */
  scrubbing: boolean;
  /** Gesture started from the input field (threshold + deferred focus) rather than from the label. */
  fromField: boolean;
}

/**
 * Scrubbable numeric field — the review chrome primitive, promoted from the 3D HUD (Phase 17).
 * Dragging horizontally **on the value or on the label** scrubs (Shift ×10, Escape cancels); a
 * clean click focuses the field and selects the text, keyboard input stays fully available.
 * Replaces sliders: compact, precise, can be aligned inline in an options bar as well as
 * in a panel row.
 *
 * `pixelsPerStep` defaults to 3; pass 6 for ranges below 1 (aperture, gamma, speed) so
 * that the gesture remains controllable.
 */
export interface NumberFieldProps {
  /** Short label or icon, shown before the value — it can be dragged too. */
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  pixelsPerStep?: number;
  /** Unit shown after the value (`%`, `°`, `×`…). */
  unit?: string;
  /** Field tooltip — completed with a reminder of the gesture. */
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
   * The visible label is a *sibling* of the input — it is the one carrying the drag gesture,
   * so it cannot wrap it. Without an association, a screen reader announces an anonymous
   * input. It is linked via `aria-labelledby`; when the label is an icon (hence without text),
   * `hint` takes over.
   */
  const labelId = useId();
  const textLabel = typeof label === 'string';
  const gesture = useRef<Gesture | null>(null);
  // The scrub is also a *state*: it decides whether to listen for Escape (see the effect).
  const [scrubbing, setScrubbing] = useState(false);
  // While typing, the input lives its own life ("-", "0,", empty field); we only commit on blur.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    const parsed = parseInput(text);
    if (parsed != null) onChange(clampValue(parsed, spec));
    setDraft(null);
  };

  /** Ends the gesture — release or cancelled pointer; ignores a foreign pointer. */
  const endGesture = (e?: ReactPointerEvent) => {
    if (e && gesture.current?.pointerId !== e.pointerId) return;
    gesture.current = null;
    setScrubbing(false);
  };

  /** Movement: arms then follows the scrub, shared by the label and the field. */
  const handleMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    if (!g.scrubbing) {
      if (!isScrub(dx)) return;
      g.scrubbing = true;
      setScrubbing(true);
    }
    // The threshold is only removed for the field: the label scrubs from the first pixel.
    onChange(dragValue(g.startValue, g.fromField ? scrubOffset(dx) : dx, spec, e.shiftKey ? 10 : 1));
  };

  /*
   * Trap: during a scrub on the field, focus is deliberately refused (the caret and the
   * selection would interfere with the gesture), so the key never reaches the input. It is
   * the window that listens for Escape, and only for the duration of the gesture, so as not
   * to take the key away from the rest of the application. The input's own Escape (discarding
   * the draft text) does not conflict: a scrub is never armed on a field already being edited.
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
        The label keeps its own hint (`dragHint`, "drag the label"): its text stays correct
        in all fourteen languages, whereas the wrapper now announces the gesture on the value
        (`scrubHint`). Rewriting the old key would have made the message wrong for all the
        other callers.
      */}
      <span
        id={textLabel ? labelId : undefined}
        title={hint ? t('numberField.dragHint', { hint }) : undefined}
        className="flex touch-none select-none items-center text-muted-foreground [cursor:ew-resize]"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // No threshold here: the label has nothing to do but be dragged.
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
          // Field already being edited: hand control back to the native caret and text
          // selection — otherwise a digit in the middle of a number could no longer be corrected.
          if (e.button !== 0 || document.activeElement === e.currentTarget) return;
          // Focus is refused until we know whether the press is a click or a scrub: cancelling
          // the pointerdown suppresses the compatibility mouse events, and therefore the
          // focusing. A clean click will focus it itself on release.
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
          // Below the threshold: it was a click. Focus it; `onFocus` selects the value.
          if (!g.scrubbing) field.focus();
        }}
        onPointerCancel={endGesture}
        className={cn(
          'h-[1.625rem] w-10 touch-none border-0 bg-transparent p-0 text-right font-mono text-xs',
          'text-foreground outline-none',
          // The cursor says what the field does: scrubbable on hover, text when editing.
          '[cursor:ew-resize] focus:[cursor:text]',
        )}
      />
      {unit && <span className="font-mono text-[0.625rem] text-muted-foreground">{unit}</span>}
    </span>
  );
}
