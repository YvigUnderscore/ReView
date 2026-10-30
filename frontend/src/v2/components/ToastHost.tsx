// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Toaster } from 'sonner';
import type { Theme } from '../stores/useTheme';

/**
 * Height freed above the first toast: the top bar measures `h-14` (3.5 rem), and
 * we leave it a gutter. Exported because it is the only thing to verify: a toast
 * that starts higher would cover the search, the bell and the upload tracker.
 */
export const TOAST_TOP_OFFSET = '4.25rem';

/**
 * The application's toasts, **at the top and centred**.
 *
 * They used to fall at the bottom right, where they covered what the corner already held: the
 * upload tracker, the anchored conversation, list pagination, the viewer HUD. Two
 * top positions were possible, and the choice matters:
 *
 * - `top-right` places a 356 px wide stack under the right end of the row, which is
 *   exactly under the search, the bell and the upload tracker: the three surfaces we
 *   have just installed there. We would be trading one overlap for another.
 * - `top-center` falls under the middle of the row, which the breadcrumb (left-aligned)
 *   leaves free, and far from the right-hand group.
 *
 * Hence `top-center`, offset by {@link TOAST_TOP_OFFSET} to pass BELOW the top bar
 * rather than over it: sonner's default offset (24 px) would have placed it in the
 * middle of a 56 px top bar. The same offset applies in phone width
 * (`mobileOffset`), where the stack takes the full width.
 */
export default function ToastHost({ theme }: { theme: Theme }) {
  return (
    <Toaster
      position="top-center"
      offset={{ top: TOAST_TOP_OFFSET }}
      mobileOffset={{ top: TOAST_TOP_OFFSET }}
      richColors
      closeButton
      theme={theme}
    />
  );
}
