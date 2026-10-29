// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Input shapes shared by the routes that write a task.
 *
 * Two routers create a task (the tasks router and the comments router, for a review
 * feedback), and the brief is bounded the same way on both sides. Two copied schemas
 * would diverge at the first adjustment, and one router's line budget is not the place
 * to describe a data shape (same pattern as `lib/commentPayload.ts`).
 */

/**
 * Maximum length of a task brief (Phase 50).
 *
 * Enough to write a real brief (several paragraphs) without letting a whole file be
 * pasted into a column that the sheet re-reads on every open.
 */
export const TASK_DESCRIPTION_MAX = 4000;

/** Brief: plain text, clearable (`null`), absent means unchanged. */
export const taskDescriptionField = z.string().max(TASK_DESCRIPTION_MAX).nullable().optional();

/**
 * What the "create a task from this feedback" dialog sends.
 *
 * The name is optional on the API side: an integration client that does not provide one
 * falls back to the comment's text, as it did before the dialog existed.
 */
export const commentTaskBody = z.object({
  name: z.string().min(1).max(160).optional(),
  description: taskDescriptionField,
});
