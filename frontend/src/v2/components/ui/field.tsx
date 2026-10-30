// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Label } from './label';

/**
 * A label and its control, really linked.
 *
 * `Label` is a generic primitive: it renders a `<label>` and expects the caller to supply
 * `htmlFor`. Almost nobody did — the label was simply placed next to the field, visually
 * correct and programmatically mute. Audit of the admin dialogs: **31 of 48 fields had no
 * accessible name**, including the sixteen in the "New service token" dialog, that is, the
 * checkboxes that decide the rights of a machine identity. To a screen reader, one was
 * ticking anonymous rights.
 *
 * `Field` creates the identifier and sets it on both sides: there is nothing left to forget.
 * The control keeps its `id` if it already has one.
 *
 * ```tsx
 * <Field label={t('user.email')}>
 *   <Input type="email" value={email} onChange={…} />
 * </Field>
 * ```
 */

interface FieldProps {
  label: ReactNode;
  /** Help text under the field, linked by `aria-describedby`. */
  hint?: ReactNode;
  /** Error message, announced and linked like the help text. */
  error?: ReactNode;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const generated = useId();
  const described = useId();
  const errorId = useId();
  if (!isValidElement(children)) return null;

  const id = children.props.id ?? generated;
  const describedBy = [hint ? described : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p id={described} className="text-2xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-2xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export default Field;
