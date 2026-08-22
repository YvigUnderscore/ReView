// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import UploadWidget, { UploadRow } from './UploadWidget';
import type { UploadItem } from '../../stores/useUploadStore';

/**
 * Le widget le plus vu de la journée renvoyait cinq libellés français en dur depuis une
 * fonction — invisibles du détecteur i18n, qui ne lit que le texte JSX. Ces cas fixent
 * les deux choses qui comptent : plus un mot hors catalogue, et une sortie possible pour
 * chaque ligne (annuler un transfert, retirer une ligne finie).
 */

const item = (over: Partial<UploadItem>): UploadItem => ({
  id: 'u1',
  filename: 'sh010_v003.mov',
  versionId: 1,
  kind: 'VIDEO',
  progress: 40,
  status: 'uploading',
  ...over,
});

const row = (over: Partial<UploadItem>): string =>
  renderToStaticMarkup(<UploadRow item={item(over)} onDismiss={() => {}} />);

describe('UploadWidget', () => {
  it('ne rend rien quand aucun transfert n’est en cours', () => {
    expect(renderToStaticMarkup(<UploadWidget />)).toBe('');
  });
});

describe('UploadRow', () => {
  it('ne laisse plus un seul libellé français en dur, quel que soit l’état', () => {
    const html = [
      row({ status: 'pending' }),
      row({ status: 'uploading' }),
      row({ status: 'finalizing' }),
      row({ status: 'processing', kind: 'VIDEO' }),
      row({ status: 'processing', kind: 'MODEL_3D' }),
      row({ status: 'processing', kind: 'IMAGE' }),
      row({ status: 'done' }),
      row({ status: 'error', error: 'boom' }),
    ].join('');
    for (const leak of [
      'En attente',
      'Validation…',
      'Transcodage',
      'Conversion 3D',
      'Traitement…',
      'Échec',
    ]) {
      expect(html).not.toContain(leak);
    }
  });

  it('distingue les états de traitement par type de média', () => {
    const video = row({ status: 'processing', kind: 'VIDEO' });
    const model = row({ status: 'processing', kind: 'MODEL_3D' });
    const image = row({ status: 'processing', kind: 'IMAGE' });
    expect(video).not.toBe(model);
    expect(model).not.toBe(image);
  });

  it('offre « annuler » sur un transfert vivant et « retirer » sur une ligne finie', () => {
    // Les libellés viennent du catalogue anglais de base, seul embarqué au démarrage.
    expect(row({ status: 'uploading' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'pending' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'finalizing' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'done' })).toContain('aria-label="Remove"');
    expect(row({ status: 'error', error: 'boom' })).toContain('aria-label="Remove"');
  });

  it('montre le nom du fichier, sa progression et le motif d’échec', () => {
    const html = row({ status: 'error', progress: 60, error: 'PUT 403' });
    expect(html).toContain('sh010_v003.mov');
    expect(html).toContain('PUT 403');
    expect(html).toContain('60%');
  });

  it('remplace la barre par une attente indéterminée pendant le traitement serveur', () => {
    expect(row({ status: 'processing', progress: 100 })).toContain('animate-pulse');
    expect(row({ status: 'uploading', progress: 100 })).not.toContain('animate-pulse');
  });
});
