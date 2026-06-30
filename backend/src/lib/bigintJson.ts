/**
 * Prisma renvoie les colonnes BigInt comme `bigint`, non sérialisable par JSON.stringify.
 * On patche le prototype pour le rendre en Number (suffisant : tailles < 2^53 octets).
 */
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

export {};
