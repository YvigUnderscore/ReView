// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '../../../i18n';
import PoiCommentPoints from './PoiCommentPoints';
import type { PoiPoint } from './poiPoints';

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

  it('ne rend rien quand le commentaire ne porte aucun point', () => {
    const { container } = render(<PoiCommentPoints points={[]} stop={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
