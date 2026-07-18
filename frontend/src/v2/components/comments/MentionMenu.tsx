import { AtSign } from 'lucide-react';
import type { Mentions } from './useMentions';

/**
 * Menu d'autocomplete des mentions (32.B), affiché au-dessus du textarea
 * (le parent doit être `relative`). Navigation clavier gérée par `useMentions`.
 */
export default function MentionMenu({ mentions }: { mentions: Mentions }) {
  if (!mentions.open) return null;
  return (
    <div className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-md border border-border bg-card shadow-lg">
      {mentions.candidates.map((c, i) => (
        <button
          key={c.id}
          type="button"
          // mousedown : évite de perdre le focus du textarea avant l'insertion
          onMouseDown={(e) => {
            e.preventDefault();
            mentions.pick(c);
          }}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
            i === mentions.activeIndex ? 'bg-secondary text-foreground' : 'text-muted-foreground'
          }`}
        >
          <AtSign size={13} className="shrink-0 text-primary" />
          <span className="truncate font-medium">{c.handle}</span>
          <span className="truncate text-xs text-muted-foreground">{c.label}</span>
        </button>
      ))}
    </div>
  );
}
