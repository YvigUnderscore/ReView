// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usePresenceQuery } from '../lib/queries';
import type { PresenceUser } from '../lib/queries';
import { t, intlLocale } from '../i18n';

export type { PresenceUser };

/** Repli stable : un littéral recréé à chaque rendu ferait retravailler les `useMemo` des appelants. */
const NO_ONE: PresenceUser[] = [];

/**
 * Présence des utilisateurs du studio.
 *
 * Simple lecture du cache TanStack Query (clé partagée, `staleTime` d'une minute) :
 * l'annuaire ne repart sur le réseau ni parce qu'un second panneau s'ouvre, ni parce
 * qu'un composant se démonte et se remonte. La fraîcheur de « qui est en ligne » vient
 * de la poussée socket `presence:update`, branchée une seule fois par le pont temps réel
 * (`usePresenceBridge`, lib/socketBridge) qui écrit dans ce même cache — et non d'un
 * magasin parallèle, ni d'un rechargement.
 */
export function usePresence(): { users: PresenceUser[] } {
  const { data } = usePresenceQuery();
  return { users: data ?? NO_ONE };
}

/** Format « actif il y a X » à partir d'un timestamp ISO. */
export function lastSeenLabel(iso: string | null, online: boolean): string {
  if (online) return t('shell.online');
  if (!iso) return t('presence.neverSeen');
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('presence.justNow');
  const rel = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto', style: 'short' });
  if (min < 60) return rel.format(-min, 'minute');
  const h = Math.floor(min / 60);
  if (h < 24) return rel.format(-h, 'hour');
  return rel.format(-Math.floor(h / 24), 'day');
}
