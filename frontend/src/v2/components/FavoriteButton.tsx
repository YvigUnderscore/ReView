import { Star } from 'lucide-react';
import { useFavorites, type FavType } from '../stores/useFavorites';

/** Bouton étoile pour (dé)favoriser une entité (projet/séquence/shot/asset). */
export default function FavoriteButton({ type, entityId, size = 16, className = '' }: {
  type: FavType; entityId: number; size?: number; className?: string;
}) {
  const isFav = useFavorites((s) => s.isFav(type, entityId));
  const toggle = useFavorites((s) => s.toggle);
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(type, entityId); }}
      title={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      aria-label={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`rounded p-1 transition-colors hover:bg-secondary ${isFav ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground'} ${className}`}
    >
      <Star size={size} fill={isFav ? 'currentColor' : 'none'} />
    </button>
  );
}
