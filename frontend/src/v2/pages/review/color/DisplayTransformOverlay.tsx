// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Image transformée, superposée à l'originale **dans le plan zoomé** de la visionneuse : elle
 * occupe exactement la boîte de l'image, suit donc le zoom, le pan et le plein écran sans que
 * la visionneuse ait à savoir qu'une gestion de couleur existe.
 *
 * Purement décorative pour l'accessibilité (`alt=""`) : elle montre la même image que celle
 * qui est déjà annoncée en dessous, avec une autre transformée d'affichage.
 */
export default function DisplayTransformOverlay({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      className="pointer-events-none absolute inset-0 block h-full w-full select-none"
    />
  );
}
