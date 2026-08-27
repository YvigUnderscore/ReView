// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Label } from './label';

/**
 * Un libellé et son contrôle, réellement liés.
 *
 * `Label` est une primitive générique : elle pose un `<label>` et attend que l'appelant
 * fournisse `htmlFor`. Presque personne ne le faisait — le libellé était simplement posé
 * à côté du champ, visuellement correct et programmatiquement muet. Relevé sur les
 * dialogues de l'administration : **31 champs sur 48 sans nom accessible**, dont les seize
 * du dialogue « Nouveau token de service », c'est-à-dire les cases qui décident des droits
 * d'une identité machine. Au lecteur d'écran, on y cochait des droits anonymes.
 *
 * `Field` fabrique l'identifiant et le pose des deux côtés : il n'y a plus rien à ne pas
 * oublier. Le contrôle garde son `id` s'il en a déjà un.
 *
 * ```tsx
 * <Field label={t('user.email')}>
 *   <Input type="email" value={email} onChange={…} />
 * </Field>
 * ```
 */

interface FieldProps {
  label: ReactNode;
  /** Texte d'aide sous le champ, relié par `aria-describedby`. */
  hint?: ReactNode;
  /** Message d'erreur, annoncé et relié comme l'aide. */
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
