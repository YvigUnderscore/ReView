// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MousePointer2 } from 'lucide-react';
import { userColor } from '../../../lib/userColor';
import { useLivePointers } from './pointerBus';

/**
 * Curseurs des autres participants, posés sur le cadre du média.
 *
 * Les coordonnées sont normalisées : le curseur désigne le même pixel d'image chez tout
 * le monde, quelle que soit la taille de la fenêtre — et il suit le zoom, puisqu'il vit
 * dans le calque transformé. La teinte est celle de l'auteur partout ailleurs (avatar,
 * annotation), pour qu'on reconnaisse qui montre sans lire le nom.
 */
export default function LivePointers() {
  const pointers = useLivePointers();
  if (pointers.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {pointers.map((p) => {
        const color = userColor(p.userId);
        return (
          <div
            key={p.userId}
            className="absolute flex items-start gap-0.5 transition-[left,top] duration-75 ease-linear"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, color }}
          >
            <MousePointer2 size={16} fill="currentColor" strokeWidth={1} />
            <span
              className="mt-2.5 max-w-28 truncate rounded px-1 py-0.5 text-2xs font-medium text-white"
              style={{ backgroundColor: color }}
            >
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
