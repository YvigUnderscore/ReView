// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MousePointer2 } from 'lucide-react';
import { userColor } from '../../../lib/userColor';
import { useLivePointers } from './pointerBus';

/**
 * Cursors of the other participants, placed on the media frame.
 *
 * The coordinates are normalized: the cursor designates the same image pixel for everyone, whatever
 * the window size, and it follows the zoom since it lives in the transformed layer. The tint is the
 * author's everywhere else (avatar, annotation), so that one recognizes who is pointing without reading the name.
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
