// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { stubLayoutMetrics } from '../../../../test/layoutMetrics';
import { t } from '../../../i18n';
import PoiCommentPoints from './PoiCommentPoints';
import type { PoiPoint } from './poiPoints';

/**
 * Le fil de commentaires est la surface LARGE — une quarantaine de caractères par ligne,
 * mesurés en navigateur. Le repliage d'une remarque s'y décide sur ce que les trois lignes
 * masquent vraiment, et happy-dom ne met rien en page : on lui prête donc cette largeur.
 */
let restore: (() => void) | null = null;

beforeEach(() => {
  restore = stubLayoutMetrics({ charsPerLine: 40 });
});

afterEach(() => {
  restore?.();
  restore = null;
});

const points: PoiPoint[] = [
  { position: '0 0 0', normal: '0 0 1', space: 'object', text: 'la soudure', images: ['k1'] },
  { position: '1 0 0', normal: '0 0 1', space: 'object', text: 'le boulon' },
];

const attachments = [
  { key: 'k1', name: 'defaut.png', contentType: 'image/png', url: 'blob:defaut' },
  { key: 'k9', name: 'autre.png', contentType: 'image/png', url: 'blob:autre' },
];

describe('PoiCommentPoints — cliquer un numéro ramène la caméra sur son point', () => {
  it('rend une rangée numérotée par point, avec sa remarque', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    expect(screen.getByText('la soudure')).toBeInTheDocument();
    expect(screen.getByText('le boulon')).toBeInTheDocument();
  });

  it('appelle le retour caméra avec le point et son rang', () => {
    const onFocus = vi.fn();
    render(
      <PoiCommentPoints points={points} attachments={attachments} onFocus={onFocus} stop={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('poi.focus', { n: 2 }) }));
    expect(onFocus).toHaveBeenCalledWith(points[1], 1);
  });

  it('sans viewer sous la main, les numéros restent du texte', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    expect(screen.queryByRole('button', { name: t('poi.focus', { n: 1 }) })).not.toBeInTheDocument();
  });

  it('n’affiche d’un point que SES images, reconnues par leur clé', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    const thumbs = screen.getAllByRole('img');
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveAttribute('alt', 'defaut.png');
  });

  it('replie une remarque trop longue au lieu de la faire défiler en largeur', () => {
    // Assez longue pour dépasser trois lignes DANS LE FIL : une remarque qui y tient déjà n'a
    // rien à faire replier, et c'est précisément ce que le comptage de caractères ignorait.
    const long =
      '/mnt/prod/seq010/sh0420/comp/v012/sh0420_comp_v012_beauty_linear_exr_sequence' +
      ' et la meme chose sur sh0430 ou la soudure ressort encore plus franchement au raccord';
    const { container } = render(
      <PoiCommentPoints
        points={[{ ...points[0], text: long }]}
        attachments={attachments}
        stop={() => undefined}
      />,
    );
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
    expect(container.querySelector('.break-words')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: t('comments.expandComment', { count: long.length }) }),
    );
    expect(container.querySelector('.line-clamp-3')).toBeNull();
  });

  it('pose la miniature du point à côté de sa remarque, pas dessous', () => {
    render(<PoiCommentPoints points={points} attachments={attachments} stop={() => undefined} />);
    const strip = screen.getByRole('img').closest('div');
    expect(strip?.parentElement?.firstElementChild?.textContent).toContain('la soudure');
    expect(strip?.className).toContain('shrink-0');
  });

  it('ne rend rien quand le commentaire ne porte aucun point', () => {
    const { container } = render(<PoiCommentPoints points={[]} stop={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
