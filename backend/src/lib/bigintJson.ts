// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Prisma returns BigInt columns as `bigint`, which JSON.stringify cannot serialise.
 * The prototype is patched to render them as Number (sufficient: sizes are below 2^53 bytes).
 */
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

export {};
