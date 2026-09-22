// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import ReviewCanvasRefs from './ReviewCanvasRefs';
import { useAnnotations } from './useAnnotations';
import { t } from '../../i18n';
import type { ReviewReferenceItem } from './reviewTypes';

/**
 * Le collage posait les références à x = 1.05 et la position partait telle quelle en base : des
 * références hors de toute bande, donc invisibles, existent déjà. Une référence se pose
 * désormais n'importe où sur le canevas, et l'affichage ne la déplace que s'il n'en montrerait
 * rien — ici aucune bande n'est mesurable (happy-dom ne mesure rien), la zone visible se réduit
 * donc au cadre du média et l'ancienne position doit y être ramenée.
 */
const ref = (over: Partial<ReviewReferenceItem> = {}): ReviewReferenceItem => ({
  id: 1,
  url: 'https://example.invalid/ref.png',
  x: 1.05,
  y: 0,
  width: 0.3,
  commentId: null,
  ...over,
});

function Host({ references }: { references: ReviewReferenceItem[] }) {
  const ann = useAnnotations();
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ReviewCanvasRefs
        mediaId={7}
        references={references}
        selectedCommentId={null}
        canManage={false}
        ann={ann}
      />
    </QueryClientProvider>
  );
}

describe('références persistées', () => {
  it('recadre à l’affichage une position enregistrée hors cadre', () => {
    render(<Host references={[ref()]} />);
    const box = screen.getByAltText(t('ref.title')).parentElement!;
    expect(box.style.left).toBe('70%');
    expect(box.style.width).toBe('30%');
  });

  it('laisse en place une position déjà dans le cadre', () => {
    render(<Host references={[ref({ x: 0.25, y: 0.5 })]} />);
    const box = screen.getByAltText(t('ref.title')).parentElement!;
    expect(box.style.left).toBe('25%');
    expect(box.style.top).toBe('50%');
  });

  it('rattrape aussi une position héritée aberrante en hauteur', () => {
    render(<Host references={[ref({ x: 0.2, y: -2.5 })]} />);
    const box = screen.getByAltText(t('ref.title')).parentElement!;
    expect(box.style.left).toBe('20%');
    expect(box.style.top).toBe('0%');
  });

  it('n’affiche pas la référence d’un commentaire qui n’est pas sélectionné', () => {
    render(<Host references={[ref({ commentId: 42 })]} />);
    expect(screen.queryByAltText(t('ref.title'))).toBeNull();
  });
});
