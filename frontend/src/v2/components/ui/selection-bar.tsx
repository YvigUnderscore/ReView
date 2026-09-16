// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { useT } from '../../i18n';

export interface SelectionAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/**
 * Barre d'actions groupées flottante (13.A). Apparaît en bas de l'écran dès qu'au moins
 * un item est sélectionné ; les actions (Supprimer / Statut / Déplacer…) sont fournies
 * par la page. « Annuler » vide la sélection.
 *
 * L'apparition et le retrait sont des `@keyframes` CSS depuis le retrait de framer-motion
 * du premier chargement (F3) : la barre reste montée le temps de redescendre, faute de quoi
 * elle disparaîtrait d'un coup là où `AnimatePresence` la faisait sortir par le bas.
 */

/** Durée du retrait, en miroir exact de la classe d'animation ci-dessous (0,18 s). */
const EXIT_MS = 180;
export default function SelectionBar({
  count,
  actions,
  onClear,
  label,
}: {
  count: number;
  actions: SelectionAction[];
  onClear: () => void;
  /** Nom accordé au nombre, sans le nombre : la barre compose « 3 » + « projets ». */
  label?: string;
}) {
  const t = useT();
  const [phase, setPhase] = useState<'absent' | 'in' | 'out'>(count > 0 ? 'in' : 'absent');
  // Compte et libellé de la dernière sélection non vide : à la dernière image du retrait,
  // la page a déjà remis le compte à zéro et la barre annoncerait « 0 sélectionnés ».
  const [frozen, setFrozen] = useState({ count, label });
  const [seenCount, setSeenCount] = useState(count);

  if (count > 0 && (frozen.count !== count || frozen.label !== label)) setFrozen({ count, label });
  if (seenCount !== count) {
    // Ajusté pendant le rendu (même motif que la coquille) : pas d'image intermédiaire
    // dans le mauvais état, et pas de `setState` dans un effet.
    setSeenCount(count);
    if (count > 0) setPhase('in');
    else if (phase !== 'absent') setPhase('out');
  }

  useEffect(() => {
    if (phase !== 'out') return;
    const id = setTimeout(() => setPhase('absent'), EXIT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  if (phase === 'absent') return null;

  const shownCount = count > 0 ? count : frozen.count;
  const shownLabel = count > 0 ? label : frozen.label;
  // 24 px de course et 0,18 s : les valeurs mêmes de l'animation d'origine.
  const move =
    phase === 'out'
      ? 'animate-out fade-out slide-out-to-bottom-6 fill-mode-forwards duration-[180ms] motion-reduce:animate-none'
      : 'animate-in fade-in slide-in-from-bottom-6 duration-[180ms] motion-reduce:animate-none';

  return (
    <div className={`pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 ${move}`}>
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur">
        <span className="text-sm font-medium">
          <span className="text-primary">{shownCount}</span> {shownLabel ?? t('common.selected')}
        </span>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-1">
          {actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.danger ? 'destructive' : 'outline'}
              onClick={a.onClick}
            >
              {a.icon}
              {a.label}
            </Button>
          ))}
          <button
            onClick={onClear}
            title={t('common.clearSelection')}
            aria-label={t('common.clearSelection')}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
