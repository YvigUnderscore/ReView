// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserStatus } from '../types/api';
import { STATUS_COLOR } from '../lib/userStatus';
import { readableInk, userColor as colorFor } from '../lib/userColor';
import { useT } from '../i18n';

/**
 * Avatar utilisateur : image uploadée si disponible, sinon pastille à initiales
 * colorée de façon déterministe. Pastille de statut optionnelle (online + statut).
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
          // Encre calculée, pas figée en blanc : aucune des douze teintes de la palette ne
          // tenait 4,5:1 avec du blanc (1,98:1 au pire). `readableInk` choisit la meilleure.
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
