// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { fetchReviewRequestRule } from '../lib/reviewRequestRule';
import type { ReviewRequestRule } from '../types/api';

/**
 * The instruction required AT UPLOAD (Phase 50).
 *
 * A media is published as soon as it is dropped: the moment when one said "here is what to
 * look at" (the publication) no longer exists as a separate step. The instruction is therefore
 * requested before sending, and a project that requires it (`reviewRequest.requireNote`) means that a
 * drop without a message does not leave at all.
 *
 * **A single point of passage.** The places from which one drops (asset sheet, shot sheet,
 * task sheet, version timeline, drop zone) go through `deliverFiles`, which calls
 * `withUploadNote` after the grouping of sequences: that prevents a new
 * button from forgetting the rule. The retained drop
 * keeps its whole gesture pending: nothing is created, not even the version, while the
 * instruction is not satisfactory.
 */

/** A retained drop: what the project requires, and the gesture that will take over again. */
interface PendingDrop {
  rule: ReviewRequestRule;
  /** The drop itself, replayed with the written instruction (or `null` if nothing is required). */
  run: (note: string | null) => void | Promise<void>;
}

interface UploadNoteState {
  /** The drop awaiting its instruction, if any. */
  pending: PendingDrop | null;
  /** The instruction is satisfactory: the drop resumes. */
  submit: (note: string | null) => void;
  /** Giving up: nothing has been created, nothing is sent. */
  cancel: () => void;
}

export const useUploadNoteStore = create<UploadNoteState>((set, get) => ({
  pending: null,
  submit: (note) => {
    const pending = get().pending;
    // Released BEFORE replaying the gesture: the latter may take time (version creation, hashing)
    // and the dialog must not stay on screen during that time.
    set({ pending: null });
    void pending?.run(note);
  },
  cancel: () => set({ pending: null }),
}));

/**
 * The single entry point of every file drop.
 *
 * Without an instruction requirement, the drop goes out immediately: the ordinary path gains
 * no screen. With a requirement, the gesture waits for `UploadNoteDialog`, mounted once for all
 * of the application: the pages therefore have nothing to render to benefit from it.
 */
export async function withUploadNote(
  projectId: number | null | undefined,
  run: (note: string | null) => void | Promise<void>,
): Promise<void> {
  const rule = await fetchReviewRequestRule(projectId);
  if (!rule.requireNote) {
    await run(null);
    return;
  }
  useUploadNoteStore.setState({ pending: { rule, run } });
}
