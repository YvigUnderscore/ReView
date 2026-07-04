import type { UserStatus } from '../types/api';
import { STATUS_COLOR } from '../lib/userStatus';

// Palette stable de couleurs de repli (dérivée d'un identifiant).
const COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
];

function colorFor(seed: number | string): string {
  const n = typeof seed === 'number' ? seed : [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return COLORS[n % COLORS.length]!;
}

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
          className="flex items-center justify-center rounded-full font-semibold text-white"
          style={{ width: size, height: size, background: colorFor(seed), fontSize: size * 0.4 }}
        >
          {initials}
        </div>
      )}
      {(status || online !== undefined) && (
        <span
          title={online ? 'En ligne' : 'Hors ligne'}
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
