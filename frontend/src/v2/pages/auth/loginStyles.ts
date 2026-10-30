// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSSProperties } from 'react';
import type { LoginAppearance } from '../../lib/branding';

/**
 * Login-styling helpers — pure functions shared by the real page
 * (`AuthLayout`) and the admin preview, so that what the admin sees is exactly what
 * their users will see.
 */

/** Image layer: background, framing, blur. `null` if there is no image. */
export function backdropStyle(login: LoginAppearance): CSSProperties | null {
  if (!login.bgUrl) return null;
  return {
    // URL in quotes, inner quotes removed: a presigned URL carries query
    // parameters and must not be able to close the `url()` function.
    backgroundImage: `url("${login.bgUrl.replace(/["\\]/g, '')}")`,
    backgroundSize: login.bgFit,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    // The blur overflows the frame: the scale avoids a transparent fringe at the edges.
    ...(login.blur > 0 ? { filter: `blur(${login.blur}px)`, transform: 'scale(1.06)' } : {}),
  };
}

/** Veil laid over the image to keep the form readable. `null` if opacity is zero. */
export function overlayStyle(login: LoginAppearance): CSSProperties | null {
  if (!login.bgUrl || login.overlay <= 0) return null;
  return { backgroundColor: `hsl(var(--background) / ${login.overlay})` };
}
