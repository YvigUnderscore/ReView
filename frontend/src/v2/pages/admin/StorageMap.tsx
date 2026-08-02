// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Panel } from './AdminPrimitives';
import { useT, type MessageKey } from '../../i18n';

/**
 * Cartographie statique des conventions de clés MinIO : où vit chaque type de fichier.
 * Source de vérité : StorageService (conventions de clés) et le worker FFmpeg (dérivés).
 */
const MAP: { typeKey: MessageKey; path: string; noteKey: MessageKey }[] = [
  {
    typeKey: 'storage.k.original',
    path: 'projects/{project}/{sequence-shot|asset}/{version}/{mediaId}/{file}',
    noteKey: 'storage.k.original.note',
  },
  {
    typeKey: 'storage.k.hls',
    path: 'derived/{mediaId}/hls/master.m3u8 + {height}p_*.ts',
    noteKey: 'storage.k.hls.note',
  },
  {
    typeKey: 'storage.k.thumb',
    path: 'derived/{mediaId}/thumbnail.jpg|webp',
    noteKey: 'storage.k.thumb.note',
  },
  {
    typeKey: 'storage.k.proxy',
    path: 'derived/{mediaId}/proxy.mp4 (+ proxy-trim.mp4 si trim)',
    noteKey: 'storage.k.proxy.note',
  },
  {
    typeKey: 'storage.k.client',
    path: 'derived/{mediaId}/client.mp4',
    noteKey: 'storage.k.client.note',
  },
  {
    typeKey: 'storage.k.sprite',
    path: 'derived/{mediaId}/timeline-sprite.jpg',
    noteKey: 'storage.k.sprite.note',
  },
  {
    typeKey: 'storage.k.glb',
    path: 'derived/{mediaId}/model.glb',
    noteKey: 'storage.k.glb.note',
  },
  {
    typeKey: 'storage.k.splat',
    path: 'derived/{mediaId}/splat-mask.bin + splat-subset.bin',
    noteKey: 'storage.k.splat.note',
  },
  {
    typeKey: 'storage.k.ref',
    path: 'derived/{mediaId}/reference-{uuid}.{ext}',
    noteKey: 'storage.k.ref.note',
  },
  {
    typeKey: 'storage.k.hdri',
    path: 'studio/hdris/{uuid}.{exr|hdr}',
    noteKey: 'storage.k.hdri.note',
  },
  {
    typeKey: 'storage.k.ocio',
    path: 'studio/ocio/{uuid}.ocio',
    noteKey: 'storage.k.ocio.note',
  },
  {
    typeKey: 'storage.k.avatar',
    path: 'avatars/{userId}.{ext}',
    noteKey: 'storage.k.avatar.note',
  },
  {
    typeKey: 'storage.k.logo',
    path: 'branding/logo-{timestamp}.{ext}',
    noteKey: 'storage.k.logo.note',
  },
  {
    typeKey: 'storage.k.doc',
    path: 'documents/{timestamp}-{file}',
    noteKey: 'storage.k.doc.note',
  },
  {
    typeKey: 'storage.k.attachment',
    path: 'comments/attachments/{userId}/{timestamp}-{file}',
    noteKey: 'storage.k.attachment.note',
  },
  {
    typeKey: 'storage.k.quarantine',
    path: 'quarantine/{mediaId}/{file}',
    noteKey: 'storage.k.quarantine.note',
  },
];

export default function StorageMap() {
  const t = useT();
  return (
    <Panel title={t('storage.map.title')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3">{t('storage.map.fileType')}</th>
              <th className="py-1.5 pr-3">{t('storage.map.location')}</th>
              <th className="py-1.5">{t('common.role')}</th>
            </tr>
          </thead>
          <tbody>
            {MAP.map((r) => (
              <tr key={r.path} className="border-t border-border align-top">
                <td className="py-1.5 pr-3 font-medium">{t(r.typeKey)}</td>
                <td className="py-1.5 pr-3">
                  <code className="rounded bg-secondary px-1 py-0.5 text-xs">{r.path}</code>
                </td>
                <td className="py-1.5 text-xs text-muted-foreground">{t(r.noteKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t('storage.map.hint')} <code>derived/</code>.
      </p>
    </Panel>
  );
}
