import { Crown, Radio } from 'lucide-react';
import { toast } from 'sonner';
import Avatar from '../../components/Avatar';
import { useAuth } from '../../stores/useAuth';
import type { LiveSession } from './useLiveSession';

/**
 * Contrôle de la salle de review live (33.B) dans l'en-tête : rejoindre/quitter,
 * participants (pilote couronné), passage de main par clic du pilote sur un avatar.
 */
export default function LiveControl({ live }: { live: LiveSession }) {
  const selfId = useAuth((s) => s.user?.id) ?? 0;

  if (!live.active) {
    return (
      <button
        onClick={live.join}
        title="Rejoindre la session live (synchronise lecture et navigation avec les autres participants)"
        className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Radio size={16} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-1.5 py-1">
      <button
        onClick={live.leave}
        title="Quitter la session live"
        className="flex items-center gap-1 rounded px-1 text-xs font-semibold text-primary"
      >
        <Radio size={14} className="animate-pulse" /> LIVE
      </button>
      <div className="flex items-center -space-x-1.5">
        {live.participants.map((p) => {
          const pilot = p.id === live.pilotId;
          const canGive = live.isPilot && !pilot;
          return (
            <button
              key={p.id}
              disabled={!canGive}
              onClick={() => {
                live.handoff(p.id);
                toast.success(`Main passée à ${p.displayName}`);
              }}
              title={
                pilot
                  ? `${p.displayName} pilote la session`
                  : canGive
                    ? `Donner la main à ${p.displayName}`
                    : p.displayName + (p.id === selfId ? ' (vous)' : '')
              }
              className={`relative rounded-full ring-2 ${pilot ? 'ring-primary' : 'ring-background'} ${
                canGive ? 'cursor-pointer hover:ring-primary/60' : 'cursor-default'
              }`}
            >
              <Avatar seed={p.id} initials={p.initials} avatarUrl={p.avatarUrl} size={22} />
              {pilot && (
                <Crown
                  size={10}
                  className="absolute -right-1 -top-1 rounded-full bg-background text-primary"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
