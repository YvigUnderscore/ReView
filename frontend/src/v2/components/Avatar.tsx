// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserStatus } from '../types/api';
import { STATUS_COLOR } from '../lib/userStatus';
import { readableInk, userColor as colorFor } from '../lib/userColor';
import { useT } from '../i18n';

/**
 * User avatar: uploaded image if available, otherwise an initials badge
 * deterministically colored. Optional status dot (online + status).
 */
export default function Avatar({
  seed,
  initials,
  avatarUrl,
  size = 32,
  status,
  online,
}: {
  seed: number | string;
  initials: string;
  avatarUrl?: string | null;
  size?: number;
  status?: UserStatus;
  online?: boolean;
}) {
  const t = useT();
  const dot = size >= 28 ? Math.round(size * 0.3) : 9;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-full font-semibold"
          // Computed ink, not fixed to white: none of the twelve palette tints
          // reached 4.5:1 with white (1.98:1 at worst). `readableInk` picks the best one.
          style={{
            width: size,
            height: size,
            background: colorFor(seed),
            color: readableInk(colorFor(seed)),
            fontSize: size * 0.4,
          }}
        >
          {initials}
        </div>
      )}
      {(status || online !== undefined) && (
        <span
          title={online ? t('presence.online') : t('presence.offline')}
          className="absolute bottom-0 right-0 rounded-full border-2 border-card"
          style={{
            width: dot,
            height: dot,
            background: online ? (status ? STATUS_COLOR[status] : '#22c55e') : '#6b7280',
          }}
        />
      )}
    </div>
  );
}
