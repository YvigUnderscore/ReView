// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createContext,
  forwardRef,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type AriaAttributes,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';

/**
 * Accessible Dialog (Radix): portal, overlay, focus trap, close on Escape/outside click,
 * automatic aria-labelledby via DialogTitle.
 * Every modal in the app MUST go through this primitive (no hand-made overlay).
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

/**
 * A written description must be announced.
 *
 * The content had `aria-describedby={undefined}` hard-coded — the known workaround for the
 * Radix warning "modal without description". Set in the primitive, it cut the description
 * of **all** modals in the product: the sentence showed on screen, but the screen reader
 * announced the title and then moved on to the first control. Radix already names the
 * attribute by itself (`Description` carries the identifier that `Content` points to);
 * it is enough to let it do so when a description is mounted, and to neutralise the
 * attribute only when there is none — otherwise it would point into the void.
 *
 * Each `DialogDescription` therefore signals itself to the enclosing content: a count, not
 * an inspection of children, because the description most often sits deep inside a
 * `DialogHeader` or a conditional render.
 */
type DescriptionRegistry = { register: () => () => void };
const DescriptionRegistryContext = createContext<DescriptionRegistry | null>(null);

const DialogContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
  const t = useT();
  const [describedCount, setDescribedCount] = useState(0);
  const registry = useMemo<DescriptionRegistry>(
    () => ({
      register: () => {
        setDescribedCount((n) => n + 1);
        return () => setDescribedCount((n) => n - 1);
      },
    }),
    [],
  );

  /*
   * Key absent: Radix links the content to the description it has mounted itself.
   * Key present and `undefined`: the attribute is removed from the DOM, with no element to
   * point to (React sets nothing, and the explicit `undefined` overrides Radix's value,
   * since it spreads the caller's props after its own).
   */
  const describedBy: Pick<AriaAttributes, 'aria-describedby'> =
    ariaDescribedBy !== undefined
      ? { 'aria-describedby': ariaDescribedBy }
      : describedCount > 0
        ? {}
        : { 'aria-describedby': undefined };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <DialogPrimitive.Content
        ref={ref}
        {...describedBy}
        /*
         * A focus that leaves is not an outside click.
         *
         * The file picker is a system window: it takes the focus, the document loses it, and
         * the modal used to close believing the user had clicked elsewhere — "choose an image"
         * was enough to lose the current record, in the brief as in an entity's settings. Only
         * an outside click closes it now; a caller that needs the other behaviour sets it up itself.
         */
        onFocusOutside={(e) => e.preventDefault()}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        <DescriptionRegistryContext.Provider value={registry}>{children}</DescriptionRegistryContext.Provider>
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <X size={16} />
          <span className="sr-only">{t('common.close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = 'DialogContent';

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-3 space-y-1', className)} {...props} />;
}

function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4 flex justify-end gap-2', className)} {...props} />;
}

const DialogTitle = forwardRef<
  ComponentRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = forwardRef<
  ComponentRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const registry = useContext(DescriptionRegistryContext);
  /*
   * **Layout** effect: the content must carry its `aria-describedby` before paint, so
   * before Radix moves focus into the modal — that is the moment assistive technology reads
   * its name and description.
   */
  useLayoutEffect(() => registry?.register(), [registry]);
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
});
DialogDescription.displayName = 'DialogDescription';

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
