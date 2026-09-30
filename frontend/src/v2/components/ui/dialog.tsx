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
 * Dialog accessible (Radix) : portal, overlay, focus trap, fermeture Échap/clic
 * extérieur, aria-labelledby automatique via DialogTitle.
 * Toute modale de l'app DOIT passer par cette primitive (pas d'overlay artisanal).
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

/**
 * Une description écrite doit être annoncée.
 *
 * Le contenu portait `aria-describedby={undefined}` en dur — le contournement connu de
 * l'avertissement Radix « modale sans description ». Posé dans la primitive, il coupait la
 * description de **toutes** les modales du produit : la phrase s'affichait à l'écran, mais
 * le lecteur d'écran annonçait le titre puis passait au premier contrôle. Radix nomme
 * pourtant l'attribut tout seul (`Description` porte l'identifiant que `Content` désigne) ;
 * il suffit de le laisser faire quand une description est montée, et de ne neutraliser
 * l'attribut que lorsqu'il n'y en a pas — sinon il pointerait dans le vide.
 *
 * Chaque `DialogDescription` se signale donc au contenu qui l'englobe : le décompte, et non
 * une inspection des enfants, car la description arrive le plus souvent au fond d'un
 * `DialogHeader` ou d'un rendu conditionnel.
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
   * Clé absente : Radix relie lui-même le contenu à la description qu'il a montée.
   * Clé présente et `undefined` : l'attribut est retiré du DOM, faute d'élément à désigner
   * (React ne pose rien, et le `undefined` explicite écrase la valeur de Radix, qui
   * étale les props de l'appelant après les siennes).
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
         * Un focus qui sort n'est pas un clic dehors.
         *
         * Le sélecteur de fichiers est une fenêtre du système : elle prend le focus, le
         * document le perd, et la modale se refermait en croyant qu'on avait cliqué
         * ailleurs — « choisir une image » suffisait à perdre la fiche en cours, dans le
         * brief comme dans les réglages d'une entité. Seul le clic dehors ferme désormais ;
         * un appelant qui aurait besoin de l'autre comportement le repose lui-même.
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
   * Effet de **layout** : le contenu doit porter son `aria-describedby` avant la peinture,
   * donc avant que Radix ne déplace le focus dans la modale — c'est à cet instant que la
   * technologie d'assistance en lit le nom et la description.
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
