// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Crown, LogOut, Radio, Volume2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import Avatar from '../../components/Avatar';
import { useAuth } from '../../stores/useAuth';
import { useLiveSessionsQuery } from '../../lib/queries';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import type { LiveSession } from './useLiveSession';
import { useT } from '../../i18n';

/**
 * Contrôle de la salle de review live (33.B) dans l'en-tête : rejoindre/quitter,
 * participants (couronne = pilote, éclair = co-pilote, anneau = driver effectif).
 * Une session déjà en cours sur ce média/playlist est signalée sur le bouton (badge
 * LIVE pulsant + nombre de participants). Gestion des rôles par le pilote : clic droit
 * sur un avatar, ou clic droit sur le chip « LIVE » (sous-menus — retours 33).
 */
export default function LiveControl({ live, projectId }: { live: LiveSession; projectId: number }) {
  const t = useT();
  const selfId = useAuth((s) => s.user?.id) ?? 0;
  const sessionsQ = useLiveSessionsQuery(projectId);
  const current = (sessionsQ.data ?? []).find((s) => s.key === live.key) ?? null;

  if (!live.active) {
    // Session en cours sans nous : badge visible incitant à rejoindre (retours 33).
    if (current)
      return (
        <button
          onClick={live.join}
          title={
            (current.pilot
              ? t('live.runningWithPilot', { pilot: current.pilot.displayName })
              : t('live.running')) +
            ` ${t('live.participants', { count: current.participantCount })} ${t('live.clickToJoin')}`
          }
          className="flex items-center gap-1 rounded-md border border-accent2/60 bg-accent2/10 px-2 py-1.5 text-xs font-semibold text-accent2 hover:bg-accent2/20"
        >
          <Radio size={14} className="animate-pulse" /> {t('live.badge')} · {current.participantCount}
        </button>
      );
    return (
      <button
        onClick={live.join}
        title={t('live.join')}
        className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Radio size={16} />
      </button>
    );
  }

  const others = live.participants.filter((p) => p.id !== selfId);

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-1.5 py-1">
      {/* Clic droit sur « LIVE » : quitter + gestion des rôles (pilote, retours 33). */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={live.leave}
            title={t('review.live.leave')}
            className="flex items-center gap-1 rounded px-1 text-xs font-semibold text-primary"
          >
            <Radio size={14} className="animate-pulse" /> LIVE
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {live.isPilot && others.length > 0 && (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Crown size={14} /> {t('live.handOver')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {others.map((p) => (
                    <ContextMenuItem
                      key={p.id}
                      onClick={() => {
                        live.handoff(p.id);
                        toast.success(t('live.handedOver', { name: p.displayName }));
                      }}
                    >
                      <Avatar seed={p.id} initials={p.initials} avatarUrl={p.avatarUrl} size={18} />
                      {p.displayName}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Zap size={14} /> Co-pilotes
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {others.map((p) => {
                    const coHost = live.coHostIds.includes(p.id);
                    return (
                      <ContextMenuItem
                        key={p.id}
                        onClick={() => {
                          live.setCoHost(p.id, !coHost);
                          toast.success(
                            coHost
                              ? t('live.coHostRemoved', { name: p.displayName })
                              : t('live.coHostAdded', { name: p.displayName }),
                          );
                        }}
                      >
                        <Avatar seed={p.id} initials={p.initials} avatarUrl={p.avatarUrl} size={18} />
                        {p.displayName}
                        {coHost && <Zap size={12} className="ml-auto text-primary" />}
                      </ContextMenuItem>
                    );
                  })}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={live.leave}>
            <LogOut size={14} /> {t('live.leaveSession')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {live.needsUnmute && (
        <button
          onClick={live.unmute}
          title={t('live.muted')}
          className="flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
        >
          <Volume2 size={12} /> {t('live.sound')}
        </button>
      )}
      <div className="flex items-center -space-x-1.5">
        {live.participants.map((p) => {
          const pilot = p.id === live.pilotId;
          const coHost = live.coHostIds.includes(p.id);
          const driver = p.id === live.driverId;
          const roleLabel = pilot ? t('live.driving') : coHost ? 'co-pilote' : 'spectateur';
          const avatar = (
            <span
              title={`${p.displayName}${p.id === selfId ? ` ${t('live.you')}` : ''} — ${roleLabel}${driver ? ' (main active)' : ''}`}
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
                    toast.success(t('live.handedOver', { name: p.displayName }));
                  }}
                >
                  <Crown size={14} /> {t('live.handOver')}
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    live.setCoHost(p.id, !coHost);
                    toast.success(
                      coHost
                        ? t('live.coHostRemoved', { name: p.displayName })
                        : t('live.coHostAdded', { name: p.displayName }),
                    );
                  }}
                >
                  <Zap size={14} />
                  {coHost ? t('live.removeCopilot') : 'Nommer co-pilote'}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
