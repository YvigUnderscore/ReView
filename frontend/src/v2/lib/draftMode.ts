// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useBranding } from './branding';

/**
 * Draft mode — the only place in the frontend that decides whether the studio works in two steps
 * (upload, then publish) or in one (a media is born published).
 *
 * Since Phase 50, a media is published on upload: drafting is no longer the normal path but a
 * **studio option**, off by default. Everything that talks about drafts on screen — the pending
 * drafts badge, the "My drafts" filter — is therefore driven by this setting, not by a constant.
 *
 * The setting travels with the studio's public identity (`/api/studio/branding`): it is the only
 * channel EVERYONE can read, including an artist who has no access to the admin settings.
 * `useStudioSettings` only serves to write it.
 */

/** Key of the setting in the `Setting` table — contract shared with the backend. */
export const DRAFT_MODE_KEY = 'draftMode';

/**
 * Is the setting active?
 *
 * The `Setting` table only stores text: the setting therefore arrives sometimes as a boolean
 * (branding), sometimes as a string (admin screen). A single verdict for both, and everything that
 * is not explicitly true is false — an absent setting must yield the default behaviour, immediate publication.
 */
export function isDraftModeOn(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  const text = value.trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'on';
}

/** What the setting is worth for the current screen. */
export function useDraftMode(): boolean {
  const { data } = useBranding();
  return isDraftModeOn(data?.draftMode);
}
