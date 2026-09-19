// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Défaut du culling Spark, écrit une seule fois. Il vivait en double : au montage de la scène
 * (`useSplat`, `applyCulling(spark, …)`) et dans l'état de session du HUD (`useSplatView`). Les
 * deux littéraux devaient rester d'accord sans que rien ne l'impose — une divergence et
 * l'interrupteur du panneau mentait dès le premier rendu, sans que le nuage ne change.
 *
 * `true` = culling neutralisé (`CULLING_OFF` de `viewerConfig`) : rien ne disparaît en zoom fort
 * ni en bord de cadre. Valeur d'origine (10.G-V1), inchangée ici.
 */
export const DEFAULT_CULLING_OFF = true;
