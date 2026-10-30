// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Search } from 'lucide-react';
import { Input, type InputProps } from './input';
import { cn } from '../../lib/utils';

/**
 * A filter field: magnifier on the left, the placeholder doubling as accessible name.
 * `wrapperClassName` sizes the field inside its toolbar (`min-w-44 flex-1`…).
 */
export function SearchInput({
  wrapperClassName,
  className,
  placeholder,
  ...props
}: InputProps & { wrapperClassName?: string; placeholder: string }) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn('pl-8', className)}
        {...props}
      />
    </div>
  );
}
