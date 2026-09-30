// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Les classes de l'aide, isolées du composant pour être vérifiables sans rendu — même
 * découpage que `button.variants.ts` et `card.variants.ts`.
 *
 * La règle que ce fichier encode : **une note explicative se réduit, un message d'erreur
 * ou de confirmation jamais**. Une aide qu'on ne lit pas a rempli son office ; une erreur
 * qu'on ne lit pas fait perdre la donnée. Les tons `error` et `success` restent donc à
 * `text-sm` quoi qu'on demande, et `size` ne s'applique qu'aux notes.
 */

/** `note` : la ligne d'aide d'un réglage. `fine` : la note de bas de panneau, un cran plus bas. */
export type HintSize = 'note' | 'fine';

/** `muted` explique ; `error` et `success` rendent compte d'une action. */
export type HintTone = 'muted' | 'error' | 'success';

export function hintClasses(tone: HintTone = 'muted', size: HintSize = 'note'): string {
  if (tone === 'error') return 'text-sm text-destructive';
  if (tone === 'success') return 'text-sm text-success';
  return size === 'fine' ? 'text-2xs text-muted-foreground' : 'text-xs text-muted-foreground';
}
