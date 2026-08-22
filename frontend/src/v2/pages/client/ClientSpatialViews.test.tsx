// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ClientModel3DView from './ClientModel3DView';
import ClientSplatView from './ClientSplatView';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import type { ClientMediaSource } from './clientTypes';

afterEach(cleanup);

const watermark = <WatermarkOverlay text="client@studio.tld" opacity={0.08} />;
const glbSource: ClientMediaSource = { url: 'https://s3/asset.glb?sig=1' };
const splatSource: ClientMediaSource = { url: 'https://s3/scan?sig=1' };

/**
 * Les deux différenciateurs du produit passaient par « pas d'aperçu ». Ce qui doit être
 * vérifiable sans GPU : le viewer est bien monté (conteneur de scène présent), le filigrane
 * couvre le média quel que soit son type, et l'invité reçoit un message qui lui parle quand
 * le partage ne sert pas de fichier exploitable.
 */
describe('ClientModel3DView', () => {
  it('monte le viewer et pose le filigrane sur un GLB partagé', () => {
    const { container } = render(
      <ClientModel3DView source={glbSource} loading={false} watermark={watermark} />,
    );
    expect(container.querySelector('[data-viewer-zone]')).not.toBeNull();
    expect(container.querySelector('.mix-blend-difference')).not.toBeNull();
    expect(container.querySelector('kbd')?.textContent).toBe('H');
  });

  it('signale au client un modèle que le partage ne sait pas servir', () => {
    const { container } = render(
      <ClientModel3DView
        source={{ url: 'https://s3/scene.usda?sig=1' }}
        loading={false}
        watermark={watermark}
      />,
    );
    // Bandeau d'indisponibilité par-dessus la zone média (z-30, fond opaque).
    expect(container.querySelector('.z-30')).not.toBeNull();
  });

  it('n’affiche pas d’indisponibilité tant que l’URL présignée arrive', () => {
    const { container } = render(<ClientModel3DView source={undefined} loading watermark={watermark} />);
    expect(container.querySelector('.z-30')).toBeNull();
  });
});

describe('ClientSplatView', () => {
  it('monte le viewer splat et pose le filigrane', () => {
    const { container } = render(
      <ClientSplatView source={splatSource} originalName="scan.spz" loading={false} watermark={watermark} />,
    );
    expect(container.querySelector('[data-viewer-zone]')).not.toBeNull();
    expect(container.querySelector('.mix-blend-difference')).not.toBeNull();
  });

  it('signale au client un fichier que Spark ne sait pas ouvrir', () => {
    const { container } = render(
      <ClientSplatView
        source={{ url: 'https://s3/take.mov?sig=1' }}
        originalName="take.mov"
        loading={false}
        watermark={watermark}
      />,
    );
    expect(container.querySelector('.z-30')).not.toBeNull();
  });
});
