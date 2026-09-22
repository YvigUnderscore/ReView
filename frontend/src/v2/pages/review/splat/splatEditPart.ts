// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommentAttachment } from '../../../../lib/commentAttachments';
import type { SdfVolumeData, SplatEdits, SplatTransform } from '../reviewTypes';

/**
 * Proposition d'édition de nuage jointe à un commentaire (Phase 50, lot 14) — la part
 * `splat-edit`, jumelle de `scene-override` pour le splat.
 *
 * C'est le même contrat que côté serveur (`lib/commentPayload`) vu de l'autre bout, et il
 * porte le geste ENTIER : la transformation TRS du nuage, les volumes de crop, le flip
 * d'orientation — **et les suppressions**, qui sont l'essentiel du travail sur un nuage.
 *
 * Les deux blobs (masque de suppression par indice, ops de sous-ensemble) ne tiennent pas
 * dans une annotation : ils partent comme pièces jointes du commentaire, et la part n'en
 * garde que la clé. La lecture ne résout cette clé que dans les pièces jointes DU MÊME
 * commentaire — déjà filtrées par préfixe côté serveur : une clé étrangère ne donne donc
 * aucune URL.
 *
 * L'écriture est stricte (Zod côté serveur) ; la LECTURE, elle, tolère l'inattendu : la
 * colonne est du JSON libre, et une part abîmée ou écrite par une version antérieure ne doit
 * pas faire tomber la lecture du commentaire qui la porte.
 */

/** Un blob de la proposition tel que l'éditeur le produit, avant téléversement. */
export interface SplatEditBlob {
  bytes: Uint8Array;
  /** Splats masqués, ou ops rejouées — de l'affichage, jamais de l'autorité. */
  count: number;
}

/** Le même blob une fois déposé : ce que la part porte réellement. */
export interface SplatEditBlobRef {
  key: string;
  count: number;
}

/** Ce que l'éditeur propose pour le prochain commentaire : le borné + les deux binaires. */
export interface SplatEditDraft {
  edits: SplatEdits;
  mask: SplatEditBlob | null;
  subset: SplatEditBlob | null;
}

/** La part relue, clés comprises. */
export interface SplatEditPartData extends SplatEdits {
  mask: SplatEditBlobRef | null;
  subset: SplatEditBlobRef | null;
}

/**
 * La proposition telle qu'elle se REJOUE : le borné, plus les URL présignées des deux blobs,
 * résolues dans les pièces jointes du commentaire porteur.
 */
export interface SplatEditProposal extends SplatEdits {
  maskUrl: string | null;
  subsetUrl: string | null;
  /** Comptes déclarés par l'auteur — pour le dire à l'écran, pas pour rejouer. */
  maskCount: number;
  subsetCount: number;
}

/** Triplet (ou quadruplet) de nombres finis — la forme que les gizmos produisent. */
function isTuple(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Transformation TRS lisible : position, quaternion et échelle au complet. */
function isSplatTransform(value: unknown): value is SplatTransform {
  const trs = value as SplatTransform | null | undefined;
  return !!trs && isTuple(trs.position, 3) && isTuple(trs.quaternion, 4) && isTuple(trs.scale, 3);
}

/** Volume de crop lisible : forme et mode connus, TRS complète. */
function isSdfVolume(value: unknown): value is SdfVolumeData {
  const vol = value as SdfVolumeData | null | undefined;
  return (
    !!vol &&
    (vol.shape === 'box' || vol.shape === 'sphere') &&
    (vol.mode === 'delete' || vol.mode === 'isolate') &&
    isSplatTransform(vol)
  );
}

/** Référence de blob lisible : une clé non vide et un compte positif. */
function isBlobRef(value: unknown): value is SplatEditBlobRef {
  const ref = value as SplatEditBlobRef | null | undefined;
  return !!ref && typeof ref.key === 'string' && ref.key.length > 0 && typeof ref.count === 'number';
}

/**
 * Relit la part `splat-edit` d'une annotation déjà découpée en parts. Rend `null` quand il n'y
 * a rien de rejouable — une part vide ne doit pas faire croire à une proposition, sans quoi le
 * bandeau du viewer s'allumerait pour un commentaire qui ne propose rien.
 */
export function readSplatEditPart(parts: Array<{ type?: string }>): SplatEditPartData | null {
  const part = parts.find((x) => x?.type === 'splat-edit') as Partial<SplatEditPartData> | undefined;
  if (!part) return null;
  const transform = isSplatTransform(part.transform) ? part.transform : null;
  const volumes = Array.isArray(part.volumes) ? part.volumes.filter(isSdfVolume) : [];
  const flip = typeof part.baseFlip === 'boolean' ? part.baseFlip : undefined;
  const mask = isBlobRef(part.mask) ? part.mask : null;
  const subset = isBlobRef(part.subset) ? part.subset : null;
  if (!transform && volumes.length === 0 && flip === undefined && !mask && !subset) return null;
  return { transform, volumes, ...(flip === undefined ? {} : { baseFlip: flip }), mask, subset };
}

/**
 * Proposition prête à rejouer : les clés de blobs sont remplacées par les URL présignées des
 * pièces jointes du commentaire porteur.
 *
 * Une clé introuvable donne une URL nulle — et non une erreur : la pièce a pu être retirée du
 * commentaire depuis. Le reste de la proposition se rejoue quand même.
 */
/**
 * Clés MinIO des deux binaires d'une proposition, lues directement dans l'annotation.
 *
 * Elles sont déposées comme pièces jointes ordinaires du commentaire — c'est ce qui leur donne
 * gratuitement le stockage, la présignature et surtout la PURGE. Le revers est qu'elles
 * s'afficheraient sous le commentaire comme des fichiers à télécharger (`splat-mask.bin`), ce
 * qu'elles ne sont pas : personne n'ouvre un bitset. La liste des pièces jointes les écarte donc
 * par cette clé, et par elle seule — un fichier `.bin` que quelqu'un joint vraiment reste offert.
 */
export function splatEditBlobKeys(annotation: unknown): string[] {
  if (!Array.isArray(annotation)) return [];
  const part = readSplatEditPart(annotation as Array<{ type?: string }>);
  if (!part) return [];
  return [part.mask?.key, part.subset?.key].filter((key): key is string => !!key);
}

export function resolveSplatEditProposal(
  part: SplatEditPartData | null,
  attachments?: readonly CommentAttachment[],
): SplatEditProposal | null {
  if (!part) return null;
  const urlOf = (ref: SplatEditBlobRef | null): string | null =>
    (ref && attachments?.find((a) => a.key === ref.key)?.url) || null;
  const { mask, subset, ...edits } = part;
  return {
    ...edits,
    maskUrl: urlOf(mask),
    subsetUrl: urlOf(subset),
    maskCount: mask?.count ?? 0,
    subsetCount: subset?.count ?? 0,
  };
}

/** L'édition en cours a-t-elle quelque chose à proposer ? (sinon rien ne part, ni blob ni part) */
export function hasSplatEditProposal(draft: SplatEditDraft | null): boolean {
  if (!draft) return false;
  return (
    !!draft.mask ||
    !!draft.subset ||
    draft.edits.volumes.some(isSdfVolume) ||
    draft.edits.baseFlip === false ||
    (isSplatTransform(draft.edits.transform) && !isIdentity(draft.edits.transform))
  );
}

/**
 * Part à joindre au prochain commentaire, ou `null` quand l'édition en cours n'a rien à dire.
 *
 * Symétrique de la lecture : ce qui part est exactement ce qui se rejoue, et rien de plus —
 * d'où la recopie champ par champ plutôt qu'un étalement de l'objet de l'éditeur, qui
 * emporterait vers un schéma `strict()` tout champ interne ajouté demain.
 */
export function buildSplatEditPart(
  edits: SplatEdits | null,
  refs?: { mask?: SplatEditBlobRef | null; subset?: SplatEditBlobRef | null },
): Record<string, unknown> | null {
  const mask = refs?.mask ?? null;
  const subset = refs?.subset ?? null;
  // Une TRS d'identité ne propose rien : la joindre ferait s'allumer le bandeau du lecteur pour
  // un commentaire qui ne déplace rien. Un masque, lui, EST une proposition à lui seul — c'est
  // le nettoyage d'un nuage, le geste le plus courant du viewer splat.
  const moves = !!edits && isSplatTransform(edits.transform) && !isIdentity(edits.transform);
  const volumes = edits?.volumes.filter(isSdfVolume) ?? [];
  if (!moves && volumes.length === 0 && edits?.baseFlip !== false && !mask && !subset) return null;
  return {
    type: 'splat-edit',
    transform: moves ? edits.transform : null,
    volumes,
    ...(edits?.baseFlip === undefined ? {} : { baseFlip: edits.baseFlip }),
    ...(mask ? { mask } : {}),
    ...(subset ? { subset } : {}),
  };
}

/**
 * La transformation laisse-t-elle le nuage exactement où il était ?
 *
 * La valeur d'identité est écrite ici plutôt qu'importée de `reviewTypes` : ce module est
 * lui-même lu par `reviewTypes`, et n'en importer que des TYPES garde la dépendance
 * entièrement effacée à la compilation — aucun cycle à l'exécution.
 */
function isIdentity(trs: SplatTransform): boolean {
  const [qx, qy, qz, qw] = trs.quaternion;
  return (
    trs.position.every((v) => v === 0) &&
    qx === 0 &&
    qy === 0 &&
    qz === 0 &&
    qw === 1 &&
    trs.scale.every((v) => v === 1)
  );
}
