// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Codes generated in series (SH010, SH020, SH030…).
 *
 * The rule lived in a `useMemo` of the generator: it could only be verified by mounting
 * the component, whereas it is pure arithmetic: a start, a step, a
 * number of digits. It is therefore moved out here and tested on its own.
 */

export interface GeneratedItem {
  code: string;
  name: string;
  /** `undefined` outside shot mode; `null` = created outside a sequence. */
  sequenceId?: number | null;
}

/** A batch remains a batch: beyond that, it is an import, not an entry. */
export const MAX_BATCH_ITEMS = 200;

export interface BatchSpec {
  prefix: string;
  start: number;
  step: number;
  padding: number;
  count: number;
  /** Common destination of the batch, when it makes sense (shot creation). */
  sequenceId?: number | null;
}

/**
 * The items of the batch, in order.
 *
 * The name follows the code: that is what a production import produces, and the shot
 * settings screen is then used to name it differently. The count is capped at
 * `MAX_BATCH_ITEMS`, and a negative count yields nothing rather than throwing.
 */
export function buildBatchItems({
  prefix,
  start,
  step,
  padding,
  count,
  sequenceId,
}: BatchSpec): GeneratedItem[] {
  const n = Math.min(Math.max(Math.trunc(count), 0), MAX_BATCH_ITEMS);
  return Array.from({ length: n }, (_, i) => {
    const code = `${prefix}${String(start + i * step).padStart(padding, '0')}`;
    return { code, name: code, sequenceId };
  });
}
