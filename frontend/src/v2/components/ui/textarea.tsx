// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type TextareaHTMLAttributes, forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Ajuste automatiquement la hauteur au contenu (entre minRows et maxRows). */
  autoGrow?: boolean;
  minRows?: number;
  maxRows?: number;
}

/** Hauteur d'une ligne approximée depuis le line-height calculé (repli 20px). */
function lineHeightOf(el: HTMLTextAreaElement): number {
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(lh) && lh > 0 ? lh : 20;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoGrow, minRows = 1, maxRows = 12, onInput, value, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    const setRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const resize = useCallback(() => {
      const el = innerRef.current;
      if (!el || !autoGrow) return;
      const lh = lineHeightOf(el);
      const pad = el.offsetHeight - el.clientHeight; // bordures + padding vertical
      el.style.height = 'auto';
      const min = lh * minRows + pad;
      const max = lh * maxRows + pad;
      el.style.height = `${Math.min(Math.max(el.scrollHeight + pad, min), max)}px`;
      el.style.overflowY = el.scrollHeight + pad > max ? 'auto' : 'hidden';
    }, [autoGrow, minRows, maxRows]);

    // Réajuste quand le contenu change de façon contrôlée (envoi/effacement du champ).
    useLayoutEffect(() => {
      resize();
    }, [resize, value]);

    return (
      <textarea
        ref={setRef}
        value={value}
        onInput={(e) => {
          resize();
          onInput?.(e);
        }}
        rows={autoGrow ? minRows : props.rows}
        className={cn(
          'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          autoGrow && 'resize-none',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
