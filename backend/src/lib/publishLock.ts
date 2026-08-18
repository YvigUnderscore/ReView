// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forbidden } from './errors';

/**
 * Verrou de publication (Phase 11 — annule 10.G-V10) : un média/une version publié est
 * définitivement figé. Toute écriture (éditions splat, masque, trim, thumbnail, reprocess,
 * transform de version) est refusée ; pour corriger un média publié, uploader une nouvelle
 * version. Seule la présentation (mise en scène caméra/DoF/reveal/LOD) reste modifiable.
 */
export function assertNotPublished(entity: { published: boolean }) {
  if (entity.published) throw forbidden('Editing is locked once published', 'PUBLISHED_LOCKED');
}
