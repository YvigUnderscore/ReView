// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
 */
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
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur">
            <span className="text-sm font-medium">
              <span className="text-primary">{count}</span> {label ?? t('common.selected')}
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
                title="Annuler la sélection"
                aria-label="Annuler la sélection"
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
