import { Crown, Radio, Volume2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import Avatar from '../../components/Avatar';
import { useAuth } from '../../stores/useAuth';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import type { LiveSession } from './useLiveSession';

/**
 * Contrôle de la salle de review live (33.B) dans l'en-tête : rejoindre/quitter,
 * participants (couronne = pilote, éclair = co-pilote, anneau = driver effectif).
 * Clic droit du pilote sur un avatar : donner la main / nommer ou retirer un co-pilote.
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
      {live.needsUnmute && (
        <button
          onClick={live.unmute}
          title="La lecture a démarré en sourdine (le navigateur bloque le son sans interaction) — cliquer pour l'activer"
          className="flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
        >
          <Volume2 size={12} /> Son
        </button>
      )}
      <div className="flex items-center -space-x-1.5">
        {live.participants.map((p) => {
          const pilot = p.id === live.pilotId;
          const coHost = live.coHostIds.includes(p.id);
          const driver = p.id === live.driverId;
          const roleLabel = pilot ? 'pilote la session' : coHost ? 'co-pilote' : 'spectateur';
          const avatar = (
            <span
              title={`${p.displayName}${p.id === selfId ? ' (vous)' : ''} — ${roleLabel}${driver ? ' (main active)' : ''}`}
              className={`relative inline-flex rounded-full ring-2 ${driver ? 'ring-primary' : 'ring-background'}`}
            >
              <Avatar seed={p.id} initials={p.initials} avatarUrl={p.avatarUrl} size={22} />
              {pilot && (
                <Crown
                  size={10}
                  className="absolute -right-1 -top-1 rounded-full bg-background text-primary"
                />
              )}
              {coHost && (
                <Zap size={10} className="absolute -right-1 -top-1 rounded-full bg-background text-primary" />
              )}
            </span>
          );
          // Gestion des rôles par clic droit — réservée au pilote, sur les autres participants.
          if (!live.isPilot || p.id === selfId) return <span key={p.id}>{avatar}</span>;
          return (
            <ContextMenu key={p.id}>
              <ContextMenuTrigger asChild>
                <button className="rounded-full">{avatar}</button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onClick={() => {
                    live.handoff(p.id);
                    toast.success(`Main passée à ${p.displayName} (pilote)`);
                  }}
                >
                  <Crown size={14} /> Donner la main (pilote)
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    live.setCoHost(p.id, !coHost);
                    toast.success(
                      coHost
                        ? `${p.displayName} n’est plus co-pilote`
                        : `${p.displayName} est co-pilote — le premier qui interagit prend la main`,
                    );
                  }}
                >
                  <Zap size={14} />
                  {coHost ? 'Retirer le co-pilotage' : 'Nommer co-pilote'}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
