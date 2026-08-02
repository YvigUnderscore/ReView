// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Star } from 'lucide-react';
import { useFavorites, type FavType } from '../stores/useFavorites';
import { useT } from '../i18n';

/** Bouton étoile pour (dé)favoriser une entité (projet/séquence/shot/asset). */
export default function FavoriteButton({
  type,
  entityId,
  size = 16,
  className = '',
}: {
  type: FavType;
  entityId: number;
  size?: number;
  className?: string;
}) {
  const t = useT();
  const isFav = useFavorites((s) => s.isFav(type, entityId));
  const toggle = useFavorites((s) => s.toggle);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(type, entityId);
      }}
      title={isFav ? t('favorites.remove') : t('favorites.add')}
      aria-label={isFav ? t('favorites.remove') : t('favorites.add')}
      className={`rounded p-1 transition-colors hover:bg-secondary ${isFav ? 'text-warning' : 'text-muted-foreground hover:text-foreground'} ${className}`}
    >
      <Star size={size} fill={isFav ? 'currentColor' : 'none'} />
    </button>
  );
}
