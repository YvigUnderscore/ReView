// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk, queryClient } from './query';
import type { ProjectSettings, ReviewRequestRule } from '../types/api';

/**
 * What the project requires of a request, and how the screen checks it BEFORE writing.
 *
 * The rule is checked three times — by the service, by the API and here. This third check is not
 * distrust: it is what greys out a button before the round trip rather than after, and what lets us
 * say *what is missing* instead of reporting a refusal. Keeping it in a single, testable place is what
 * stops it from diverging from the other two.
 */

/** The fallback while the settings are not loaded yet: nothing is required. */
export const NO_RULE: ReviewRequestRule = { requireNote: false, minNoteLength: 5 };

/**
 * The request for the project's effective settings, described once.
 *
 * Same cache key as everywhere else (`qk.projectSettings`): the Settings tab has often already loaded
 * the record, and a second request for the same data would be wasteful. The hook and the reader outside
 * a component share it, so that they cannot query two different places.
 */
const ruleQuery = (projectId: number) => ({
  queryKey: qk.projectSettings(projectId),
  queryFn: () =>
    api.get<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`).then((d) => d.settings),
  staleTime: 5 * 60_000,
});

/** The project's rule, as a screen reads it. */
export function useReviewRequestRule(projectId: number | undefined, enabled = true): ReviewRequestRule {
  const { data } = useQuery({ ...ruleQuery(projectId ?? 0), enabled: enabled && !!projectId });
  return data?.reviewRequest ?? NO_RULE;
}

/**
 * The same rule, read OUTSIDE a component — the upload queue must know it before it has a screen to
 * render, and a `useQuery` cannot be read from a store.
 *
 * Same key and same request as the hook: the cache, already warm, answers without a round trip, and
 * the rule cannot say two different things depending on who asks.
 *
 * Unreadable rule (network down, unknown project): we fall back on "nothing is required".
 * Blocking an upload on a missed round trip would lose an artist's work, whereas the server remains the
 * authority and will refuse the submission if the project imposes it.
 */
export async function fetchReviewRequestRule(
  projectId: number | null | undefined,
): Promise<ReviewRequestRule> {
  if (!projectId) return NO_RULE;
  try {
    const settings = await queryClient.ensureQueryData(ruleQuery(projectId));
    return settings.reviewRequest ?? NO_RULE;
  } catch {
    return NO_RULE;
  }
}

/** What is wrong with a request, or `null` if it is acceptable. */
export type NoteIssue = 'missing' | 'too-short' | null;

/**
 * Same verdict as `checkReviewNote` on the server, to the letter: a space does not count, an empty
 * request is a problem only if the project requires it, and the floor applies to any written request —
 * including an optional one.
 */
export function noteIssue(note: string, rule: ReviewRequestRule): NoteIssue {
  const text = note.trim();
  if (!text) return rule.requireNote ? 'missing' : null;
  return text.length < rule.minNoteLength ? 'too-short' : null;
}

/** What is sent: an empty request goes out as `null`, as the server stores it. */
export const toNotePayload = (note: string): string | null => note.trim() || null;
