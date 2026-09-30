// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type LabelHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    // Primitive générique : l'association au contrôle (`htmlFor`) et le texte du libellé
    // arrivent de l'appelant par `{...props}` / `children`, invisibles pour la règle ici.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none text-foreground', className)}
      {...props}
    />
  ),
);
Label.displayName = 'Label';

export { Label };
