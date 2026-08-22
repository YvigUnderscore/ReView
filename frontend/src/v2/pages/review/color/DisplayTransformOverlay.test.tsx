// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import DisplayTransformOverlay from './DisplayTransformOverlay';

describe('DisplayTransformOverlay', () => {
  it('ne pose rien tant qu’aucune image transformée n’existe', () => {
    const { container } = render(<DisplayTransformOverlay url={null} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('couvre exactement la boîte de l’image et reste transparente aux gestes', () => {
    const { container } = render(<DisplayTransformOverlay url="blob:review/transformed" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'blob:review/transformed');
    // Décorative : la visionneuse en dessous porte déjà le texte de remplacement.
    expect(img).toHaveAttribute('alt', '');
    expect(img.className).toContain('absolute inset-0');
    expect(img.className).toContain('pointer-events-none');
  });
});
