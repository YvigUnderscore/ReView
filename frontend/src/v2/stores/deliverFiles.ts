// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { planDrop, sendPlan } from './useSequenceUploadStore';
import { withUploadNote } from './useUploadNoteStore';

/**
 * The single entry point of every file drop intended for a version.
 *
 * The four places from which one delivers (asset sheet, shot sheet, task sheet, version
 * timeline) all go through here and nowhere else: that is what guarantees that a shot delivered
 * as a thousand EXR frames becomes ONE media and not a thousand, and that no drop escapes the
 * instruction required by the project.
 *
 * The order is deliberate: grouping, then instruction, then only the target. `target`
 * receives the ready-made upload and decides the version, creating it if needed. Giving up on
 * either dialog therefore creates nothing, not even an empty version.
 */
export async function deliverFiles(
  projectId: number | null | undefined,
  files: File[],
  target: (send: (versionId: number) => void) => void | Promise<void>,
): Promise<void> {
  if (files.length === 0) return;
  const plan = await planDrop(files);
  if (!plan) return;
  await withUploadNote(projectId, (note) => target((versionId) => sendPlan(plan, versionId, note)));
}
