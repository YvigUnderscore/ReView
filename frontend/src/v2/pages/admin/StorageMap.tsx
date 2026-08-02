// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Panel } from './AdminPrimitives';

/**
 * Cartographie statique des conventions de clés MinIO : où vit chaque type de fichier.
 * Source de vérité : StorageService (conventions de clés) et le worker FFmpeg (dérivés).
 */
const MAP: { type: string; path: string; note: string }[] = [
  {
    type: 'Fichier uploadé (original)',
    path: 'projects/{projet}/{séquence-shot|asset}/{version}/{idMédia}/{fichier}',
    note: 'Source de vérité, jamais modifiée. Chemin lisible par slugs hiérarchiques.',
  },
  {
    type: 'Renditions HLS (vidéo)',
    path: 'derived/{idMédia}/hls/master.m3u8 + {hauteur}p_*.ts',
    note: 'Streaming adaptatif généré par le worker FFmpeg au transcodage.',
  },
  {
    type: 'Miniature',
    path: 'derived/{idMédia}/thumbnail.jpg|webp',
    note: 'Vignette des listes et du kanban.',
  },
  {
    type: 'Proxy vidéo',
    path: 'derived/{idMédia}/proxy.mp4 (+ proxy-trim.mp4 si trim)',
    note: 'Lecture rapide et re-transcodages sans retoucher l’original.',
  },
  {
    type: 'MP4 client (burn-ins)',
    path: 'derived/{idMédia}/client.mp4',
    note: 'Servi uniquement par les partages clients (watermark/slate).',
  },
  {
    type: 'Sprite de timeline',
    path: 'derived/{idMédia}/timeline-sprite.jpg',
    note: 'Aperçus au survol de la timeline vidéo.',
  },
  {
    type: 'GLB converti (3D / USD)',
    path: 'derived/{idMédia}/model.glb',
    note: 'Conversion FBX/OBJ/USD → GLB pour le viewer 3D.',
  },
  {
    type: 'Éditions splat',
    path: 'derived/{idMédia}/splat-mask.bin + splat-subset.bin',
    note: 'Masque et transformations non-destructifs, rejoués pour tous.',
  },
  {
    type: 'Image de référence (review 2D)',
    path: 'derived/{idMédia}/reference-{uuid}.{ext}',
    note: 'Références épinglées au canvas de la review image.',
  },
  {
    type: 'HDRI studio',
    path: 'studio/hdris/{uuid}.{exr|hdr}',
    note: 'Bibliothèque d’éclairage 3D/splat (admin > 3D & Splat).',
  },
  {
    type: 'Config OCIO',
    path: 'studio/ocio/{uuid}.ocio',
    note: 'Gestion de couleur (admin > Couleur).',
  },
  {
    type: 'Avatar utilisateur',
    path: 'avatars/{idUtilisateur}.{ext}',
    note: 'Photo de profil.',
  },
  {
    type: 'Logo du studio',
    path: 'branding/logo-{horodatage}.{ext}',
    note: 'Identité visuelle (admin > Réglages).',
  },
  {
    type: 'Document PDF',
    path: 'documents/{horodatage}-{fichier}',
    note: 'Page Documents (globale ou par projet).',
  },
  {
    type: 'Pièce jointe de commentaire',
    path: 'comments/attachments/{idUtilisateur}/{horodatage}-{fichier}',
    note: 'Images, PDF, zips et notes vocales des fils de review.',
  },
  {
    type: 'Fichier en quarantaine',
    path: 'quarantine/{idMédia}/{fichier}',
    note: 'Upload détecté infecté (ClamAV), isolé de la diffusion.',
  },
];

export default function StorageMap() {
  return (
    <Panel title="Où vit chaque fichier ? (conventions du bucket)">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3">Type de fichier</th>
              <th className="py-1.5 pr-3">Emplacement (clé objet)</th>
              <th className="py-1.5">Rôle</th>
            </tr>
          </thead>
          <tbody>
            {MAP.map((r) => (
              <tr key={r.path} className="border-t border-border align-top">
                <td className="py-1.5 pr-3 font-medium">{r.type}</td>
                <td className="py-1.5 pr-3">
                  <code className="rounded bg-secondary px-1 py-0.5 text-xs">{r.path}</code>
                </td>
                <td className="py-1.5 text-xs text-muted-foreground">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Un seul bucket S3/MinIO pour toute l’instance ; la suppression d’un média purge son dossier d’original
        et son préfixe <code>derived/</code>.
      </p>
    </Panel>
  );
}
