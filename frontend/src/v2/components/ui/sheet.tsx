// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef, type HTMLAttributes } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';

/**
 * Sheet (drawer latéral droit) accessible, bâti sur Radix Dialog : portal,
 * overlay, focus trap, fermeture Échap/clic extérieur. Même règle que ui/dialog :
 * aucun panneau latéral artisanal dans les pages.
 */
const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;

const SheetContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogPrimitive.Content
        ref={ref}
        aria-describedby={undefined}
        // Même règle que la modale : une fenêtre du système qui prend le focus (sélecteur
        // de fichiers) n'est pas un clic dehors, et ne doit pas refermer le panneau.
        onFocusOutside={(e) => e.preventDefault()}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-card text-card-foreground shadow-xl outline-none',
          'data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right duration-200',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <X size={16} />
          <span className="sr-only">{t('common.close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = 'SheetContent';

function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 border-b border-border px-5 py-4', className)} {...props} />;
}

function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4', className)}
      {...props}
    />
  );
}

const SheetTitle = forwardRef<
  ComponentRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('pr-8 text-base font-semibold', className)} {...props} />
));
SheetTitle.displayName = 'SheetTitle';

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetBody, SheetTitle };
