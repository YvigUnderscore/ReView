// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usePresenceQuery } from '../lib/queries';
import type { PresenceUser } from '../lib/queries';
import { t, intlLocale } from '../i18n';

export type { PresenceUser };

/** Stable fallback: a literal recreated on every render would make callers' `useMemo` recompute. */
const NO_ONE: PresenceUser[] = [];

/**
 * Presence of the studio's users.
 *
 * A plain read of the TanStack Query cache (shared key, one-minute `staleTime`): the directory
 * does not go back to the network because a second panel opens, nor because a component unmounts
 * and remounts. The freshness of "who is online" comes from the `presence:update` socket push,
 * wired up once by the real-time bridge (`usePresenceBridge`, lib/socketBridge) which writes into
 * that same cache — not from a parallel store, nor from a reload.
 */
export function usePresence(): { users: PresenceUser[] } {
  const { data } = usePresenceQuery();
  return { users: data ?? NO_ONE };
}

/** "Active X ago" format from an ISO timestamp. */
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
