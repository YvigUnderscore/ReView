// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookText, SlidersHorizontal } from 'lucide-react';
import { CommandGroup, CommandItem } from '../ui/command';
import { useT } from '../../i18n';
import type { SurfaceHits } from './useSurfaceSearch';

/**
 * Les résultats qui ne sont pas des enregistrements mais des **écrans** : une page de
 * documentation, un panneau de réglages. Rendus à part de `PaletteResults`, dont toutes les
 * familles viennent de `GET /api/search` — celles-ci se calculent en mémoire
 * (`surfaceSearch`), et le cloisonnement des réglages est déjà fait à ce stade.
 *
 * Ce composant ne fait que rendre : il ne connaît ni la saisie, ni le rôle du lecteur.
 */

const ICON = 'text-muted-foreground';

export default function PaletteSurfaces({ hits, onGo }: { hits: SurfaceHits; onGo: (to: string) => void }) {
  const t = useT();
  return (
    <>
      {hits.settings.length > 0 && (
        <CommandGroup heading={t('nav.settings')}>
          {hits.settings.map((hit) => (
            <CommandItem key={hit.id} value={hit.id} onSelect={() => onGo(hit.to)}>
              <SlidersHorizontal size={15} className={ICON} />
              <span className="truncate">{hit.label}</span>
              <span className="truncate text-xs text-muted-foreground">{hit.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {hits.docs.length > 0 && (
        <CommandGroup heading={t('nav.documentation')}>
          {hits.docs.map((hit) => (
            <CommandItem key={hit.id} value={hit.id} onSelect={() => onGo(hit.to)}>
              <BookText size={15} className={ICON} />
              <span className="truncate">{hit.label}</span>
              <span className="truncate text-xs text-muted-foreground">{hit.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}
