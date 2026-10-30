// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import DisplayTransformOverlay from './DisplayTransformOverlay';

describe('DisplayTransformOverlay', () => {
  it('draws nothing as long as no transformed image exists', () => {
    const { container } = render(<DisplayTransformOverlay url={null} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('covers exactly the image box and stays transparent to gestures', () => {
    const { container } = render(<DisplayTransformOverlay url="blob:review/transformed" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'blob:review/transformed');
    // Decorative: the viewer underneath already carries the alt text.
    expect(img).toHaveAttribute('alt', '');
    expect(img.className).toContain('absolute inset-0');
    expect(img.className).toContain('pointer-events-none');
  });
});
