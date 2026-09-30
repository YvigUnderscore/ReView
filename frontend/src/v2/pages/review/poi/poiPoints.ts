// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Hotspot3D } from '../reviewTypes';

/**
 * Points d'intérêt d'un commentaire — modèle **pur**, donc lisible et testable sans viewer.
 *
 * FORME ARRÊTÉE : **un commentaire porteur, des points numérotés**. Un seul commentaire part ;
 * il porte la géométrie de chaque point (en espace OBJET, comme les hotspots et les traits de
 * la brosse, donc rejouée à l'identique pour tout spectateur), la remarque propre à chaque
 * point, et les images — jointes au commentaire une seule fois, chaque point notant lesquelles
 * sont les siennes par leur clé MinIO.
 *
 * C'est ce choix qui laisse le reste du produit inchangé : le portail client, l'export de notes
 * et le pont ShotGrid lisent `content`, où les remarques sont recopiées numérotées.
 */

/** Plafond de points par commentaire — miroir de `MAX_POI_POINTS` (Zod backend). */
export const MAX_POI_POINTS = 20;

/** Point d'intérêt tel qu'il est STOCKÉ dans la part `poi` de `Comment.annotation`. */
export interface PoiPoint extends Hotspot3D {
  /** Remarque propre à ce point — recopiée numérotée dans le texte du commentaire. */
  text?: string;
  /** Clés des pièces jointes du commentaire qui appartiennent à ce point. */
  images?: string[];
}

/** Part d'annotation portée par le commentaire (une seule, tous les points dedans). */
export interface PoiPart {
  type: 'poi';
  points: PoiPoint[];
}

/** Une position lisible suffit à faire un point ; le texte et les images sont facultatifs. */
function readPoint(value: unknown): PoiPoint | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<PoiPoint>;
  if (typeof p.position !== 'string' || typeof p.normal !== 'string') return null;
  const images = Array.isArray(p.images) ? p.images.filter((k) => typeof k === 'string') : undefined;
  return {
    position: p.position,
    normal: p.normal,
    ...(p.space === 'object' ? { space: 'object' as const } : {}),
    ...(typeof p.text === 'string' && p.text ? { text: p.text } : {}),
    ...(images && images.length ? { images } : {}),
  };
}

/**
 * Points d'un commentaire, dans leur ordre de pose (leur numéro est leur rang + 1).
 *
 * Lecture **tolérante**, comme le reste de `splitAnnotationParts` : un commentaire écrit avant
 * cette forme ne porte qu'une part `hotspot`, et vaut donc exactement un point numéroté « 1 ».
 * Rien n'est réécrit en base ; c'est la lecture qui unifie les deux générations.
 */
export function readPoiPoints(annotation: unknown): PoiPoint[] {
  if (!Array.isArray(annotation)) return [];
  const parts = annotation as { type?: string; points?: unknown }[];
  const part = parts.find((x) => x?.type === 'poi');
  if (part && Array.isArray(part.points)) {
    const points = part.points.map(readPoint).filter((p): p is PoiPoint => p !== null);
    if (points.length) return points.slice(0, MAX_POI_POINTS);
  }
  const legacy = readPoint(parts.find((x) => x?.type === 'hotspot'));
  return legacy ? [legacy] : [];
}

/** Part à joindre au commentaire, ou `null` si aucun point n'a été posé. */
export function buildPoiPart(points: readonly PoiPoint[]): PoiPart | null {
  const kept = points.slice(0, MAX_POI_POINTS);
  return kept.length ? { type: 'poi', points: kept.map((p) => ({ ...p })) } : null;
}

/** Ligne numérotée d'un point : « 3. la soudure se voit » (numéro seul si rien n'est écrit). */
export function poiLine(index: number, text?: string): string {
  const note = (text ?? '').trim();
  return note ? `${index + 1}. ${note}` : `${index + 1}.`;
}

/** Bloc numéroté complet, tel qu'il est recopié en queue du texte du commentaire. */
export function poiBlock(points: readonly { text?: string }[]): string {
  return points.map((p, i) => poiLine(i, p.text)).join('\n');
}

/**
 * Texte du commentaire porteur : ce que l'auteur a écrit, puis le bloc numéroté. Le bloc y est
 * recopié pour que tout ce qui ne lit que `content` — portail client, export de notes, note
 * ShotGrid — voie les remarques point par point sans rien connaître de l'annotation.
 *
 * `fallback` sert au cas où il n'y a ni texte ni point : c'est le placeholder minimal que la
 * contrainte de contenu du backend exige.
 */
export function poiContent(text: string, points: readonly { text?: string }[], fallback: string): string {
  const head = text.trim();
  const block = poiBlock(points);
  if (head && block) return `${head}\n\n${block}`;
  return head || block || fallback;
}

/**
 * L'inverse exact de `poiContent` : rend le texte de l'auteur, sans le bloc numéroté que la
 * colonne des commentaires rend elle-même en rangées cliquables. Si la queue ne correspond pas
 * (commentaire édité à la main, note importée), rien n'est retiré — on préfère un doublon
 * visible à une phrase tronquée.
 */
export function stripPoiBlock(content: string, points: readonly { text?: string }[]): string {
  const block = poiBlock(points);
  if (!block) return content;
  const trimmed = content.trimEnd();
  if (!trimmed.endsWith(block)) return content;
  return trimmed.slice(0, trimmed.length - block.length).trimEnd();
}
