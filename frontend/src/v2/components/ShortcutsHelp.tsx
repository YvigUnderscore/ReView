// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { usePreferences, useUpdatePreferences } from '../lib/usePreferences';
import {
  GLOBAL_SHORTCUTS,
  isValidKey,
  resolveBindings,
  type ShortcutDef,
  type ShortcutId,
} from '../lib/shortcutRegistry';

/**
 * Panneau récapitulatif des raccourcis clavier (10.A3), ouvert avec `?`.
 * La section « Navigation » est pilotée par le registre (`shortcutRegistry`) et **éditable** :
 * cliquer une touche capture la prochaine frappe et persiste la surcharge (42.A2). Les autres
 * sections restent une référence statique (raccourcis contextuels gérés dans les vues review).
 */

// Raccourcis contextuels de review — référence non reconfigurable (gérés dans les vues).
const STATIC_GROUPS: { title: string; shortcuts: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Review vidéo',
    shortcuts: [
      { keys: ['Espace'], label: 'Lecture / pause' },
      { keys: ['←', '→'], label: '± 1 frame' },
      { keys: ['Maj', '←/→'], label: '± 10 frames' },
      { keys: ['J'], label: 'Lecture arrière (répéter : ×2, ×4, ×8)' },
      { keys: ['K'], label: 'Pause' },
      { keys: ['L'], label: 'Lecture avant (répéter : ×2, ×4, ×8)' },
      { keys: ['I', 'O'], label: 'Point de boucle in / out (Maj+I/O : effacer)' },
      { keys: ['M'], label: 'Commenter à la frame courante' },
    ],
  },
  {
    title: 'Review (tous types)',
    shortcuts: [
      { keys: ['Échap'], label: "Masquer l'annotation affichée" },
      { keys: ['Ctrl', 'V'], label: 'Coller une image de référence (review image)' },
      { keys: ['Clic droit'], label: 'Menu contextuel (image/vidéo) — navigation en 3D/splat' },
    ],
  },
  {
    title: 'Review splat',
    shortcuts: [
      {
        keys: ['Clic droit', 'ZQSD'],
        label: 'Vol type Unreal — A/E : descendre/monter, molette : vitesse, Maj : accélérer',
      },
      { keys: ['T', 'R', 'S'], label: 'Gizmos déplacer / tourner / échelle (éditeur)' },
      {
        keys: ['B', 'L', 'P'],
        label: 'Sélection rectangle / lasso / pinceau de surface (Maj ajoute, Alt retire)',
      },
      { keys: ['F'], label: 'Cadrer la sélection (ou tout le splat)' },
      { keys: ['H'], label: "Vue d'origine" },
      { keys: ['Suppr'], label: 'Supprimer la sélection (non-destructif)' },
      { keys: ['Ctrl', 'Z / Y'], label: 'Annuler / rétablir' },
    ],
  },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Représentation clavier d'un raccourci global résolu (leader `g` explicité). */
function displayKeys(def: ShortcutDef, key: string): string[] {
  const label = key === '?' ? '?' : key.toUpperCase();
  return def.kind === 'leader-g' ? ['G', label] : [label];
}

/** Section « Navigation » éditable : chaque touche est reconfigurable (persistée compte). */
function NavShortcuts() {
  const prefsQ = usePreferences();
  const update = useUpdatePreferences();
  const shortcuts = prefsQ.data?.shortcuts;
  const overrides = useMemo(() => shortcuts ?? {}, [shortcuts]);
  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const def = GLOBAL_SHORTCUTS.find((s) => s.id === capturing)!;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setCapturing(null);
      const key = e.key.toLowerCase();
      if (!isValidKey(key)) {
        toast.error('Touche invalide (une seule touche, jamais « g »).');
        return;
      }
      const conflict = GLOBAL_SHORTCUTS.some(
        (s) => s.id !== capturing && s.kind === def.kind && bindings[s.id] === key,
      );
      if (conflict) {
        toast.error('Touche déjà utilisée par un autre raccourci.');
        return;
      }
      const next = { ...overrides };
      if (key === def.defaultKey) delete next[capturing];
      else next[capturing] = key;
      update.mutate({ shortcuts: next }, { onSuccess: () => toast.success('Raccourci mis à jour') });
      setCapturing(null);
    };
    // Capture-phase : primer sur Radix (Échap ne ferme pas le dialog pendant la capture).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, overrides, bindings, update]);

  const reset = (id: ShortcutId) => {
    const next = { ...overrides };
    delete next[id];
    update.mutate({ shortcuts: next });
  };

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Navigation</p>
      <p className="mb-2 text-[11px] text-muted-foreground">Cliquez une touche pour la reconfigurer.</p>
      <ul className="space-y-1.5">
        <li className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Recherche globale (palette de commandes)</span>
          <Keys keys={['Ctrl', 'K']} />
        </li>
        {GLOBAL_SHORTCUTS.map((def) => {
          const isCapturing = capturing === def.id;
          const custom = isValidKey(overrides[def.id] ?? '') && overrides[def.id] !== def.defaultKey;
          return (
            <li key={def.id} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{def.label}</span>
              <span className="flex items-center gap-2">
                {isCapturing ? (
                  <span className="text-xs font-medium text-primary">Appuyez sur une touche…</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCapturing(def.id)}
                    className="rounded hover:opacity-80"
                    title="Cliquer pour changer la touche"
                  >
                    <Keys keys={displayKeys(def, bindings[def.id])} />
                  </button>
                )}
                {custom && !isCapturing && (
                  <button
                    type="button"
                    onClick={() => reset(def.id)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Réinitialiser au défaut"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + scroll : la liste des raccourcis ne doit jamais déborder de l'écran. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <NavShortcuts />
          {STATIC_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </p>
              <ul className="space-y-1.5">
                {g.shortcuts.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">{s.label}</span>
                    <Keys keys={s.keys} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
