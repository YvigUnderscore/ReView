import { Bookmark, Plus } from 'lucide-react';
import { HudGroup } from './hud/ViewerHud';
import type { Model3DBookmarksState } from './three/useModel3DBookmarks';

/**
 * Barre des bookmarks caméra partagés (39.D) : un bouton numéroté par vue enregistrée (rappel au
 * clic ou touches 1-9). Le gestionnaire ajoute la vue courante (+) et retire une vue par clic droit.
 * Masquée s'il n'y a aucun bookmark et pas de droit d'édition (rien à montrer au spectateur).
 */
export default function BookmarksBar({ bm }: { bm: Model3DBookmarksState }) {
  const { bookmarks, recall, add, remove, busy, full } = bm;
  if (bookmarks.length === 0 && !add) return null;
  return (
    <HudGroup>
      <Bookmark size={14} className="text-muted-foreground" />
      {bookmarks.map((b, i) => (
        <button
          key={i}
          onClick={() => recall(i)}
          onContextMenu={
            remove
              ? (e) => {
                  e.preventDefault();
                  void remove(i);
                }
              : undefined
          }
          title={`${b.label ?? `Vue ${i + 1}`}${i < 9 ? ` — touche ${i + 1}` : ''}${
            remove ? ' (clic droit : retirer)' : ''
          }`}
          className="min-w-6 rounded border border-border px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {i + 1}
        </button>
      ))}
      {add && (
        <button
          onClick={() => void add()}
          disabled={busy || full}
          title={full ? 'Maximum de bookmarks atteint' : 'Enregistrer la vue courante — partagée'}
          className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <Plus size={12} /> Vue
        </button>
      )}
    </HudGroup>
  );
}
