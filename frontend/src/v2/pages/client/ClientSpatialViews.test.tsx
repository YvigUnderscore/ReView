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
 * The two product differentiators used to rely on "no preview". What must be verifiable
 * without a GPU: the viewer is mounted (scene container present), the watermark covers the
 * media whatever its type, and the guest gets a message addressed to them when the share
 * does not serve a usable file.
 */
describe('ClientModel3DView', () => {
  it('mounts the viewer and places the watermark on a shared GLB', () => {
    const { container } = render(
      <ClientModel3DView source={glbSource} loading={false} watermark={watermark} />,
    );
    expect(container.querySelector('[data-viewer-zone]')).not.toBeNull();
    expect(container.querySelector('.mix-blend-difference')).not.toBeNull();
    // No usage-instructions strip under the viewer: it permanently took up screen space to
    // narrate what the reader already sees.
    expect(container.querySelector('kbd')).toBeNull();
  });

  it('signals a model the share cannot serve to the client', () => {
    const { container } = render(
      <ClientModel3DView
        source={{ url: 'https://s3/scene.usda?sig=1' }}
        loading={false}
        watermark={watermark}
      />,
    );
    // Unavailability banner over the media area (z-30, opaque background).
    expect(container.querySelector('.z-30')).not.toBeNull();
  });

  it('shows no unavailability while the presigned URL is arriving', () => {
    const { container } = render(<ClientModel3DView source={undefined} loading watermark={watermark} />);
    expect(container.querySelector('.z-30')).toBeNull();
  });
});

describe('ClientSplatView', () => {
  it('mounts the splat viewer and places the watermark', () => {
    const { container } = render(
      <ClientSplatView source={splatSource} originalName="scan.spz" loading={false} watermark={watermark} />,
    );
    expect(container.querySelector('[data-viewer-zone]')).not.toBeNull();
    expect(container.querySelector('.mix-blend-difference')).not.toBeNull();
  });

  it('signals a file that Spark cannot open to the client', () => {
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
