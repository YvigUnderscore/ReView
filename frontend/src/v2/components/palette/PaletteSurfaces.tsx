// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookText, SlidersHorizontal } from 'lucide-react';
import { CommandGroup, CommandItem } from '../ui/command';
import { useT } from '../../i18n';
import type { SurfaceHits } from './useSurfaceSearch';

/**
 * The results that are not records but **screens**: a documentation page, a settings panel. Rendered apart from
 * `PaletteResults`, whose families all come from `GET /api/search`. These are computed in memory (`surfaceSearch`), and the
 * segregation of settings is already done at that stage.
 *
 * This component only renders: it knows neither the input nor the reader's role.
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
