// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClientComments from './ClientComments';
import type { ClientComment } from '../../types/api';

const comment = (patch: Partial<ClientComment> = {}): ClientComment => ({
  id: 1,
  content: 'Trop sombre',
  timestamp: 65,
  guestName: 'Client',
  author: null,
  createdAt: '2026-08-21T10:00:00.000Z',
  ...patch,
});

const render = (props: Partial<Parameters<typeof ClientComments>[0]> = {}) =>
  renderToStaticMarkup(
    <ClientComments
      comments={[comment()]}
      canComment={false}
      timed
      onSeek={vi.fn()}
      onSubmit={vi.fn()}
      composerRef={createRef<HTMLTextAreaElement>()}
      {...props}
    />,
  );

/**
 * Le fil client décide de deux choses seulement, mais elles comptent : le lien de permission
 * VIEW ne doit pas offrir de composeur, et un horodatage n'a de sens que sur un média qui
 * porte un temps. Les assertions visent la structure, jamais le texte traduit.
 */
describe('ClientComments', () => {
  it('n’offre aucun composeur sur un lien en lecture seule', () => {
    const html = render({ canComment: false });
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<textarea');
  });

  it('ouvre le composeur dès que le lien autorise le commentaire', () => {
    const html = render({ canComment: true });
    expect(html).toContain('<form');
    expect(html).toContain('<textarea');
  });

  it('rend l’horodatage cliquable sur une vidéo', () => {
    expect(render({ timed: true })).toContain('01:05');
  });

  it('n’affiche pas d’horodatage sur un média sans temps', () => {
    expect(render({ timed: false })).not.toContain('01:05');
  });

  it('nettoie le balisage résiduel d’un commentaire plutôt que de l’injecter', () => {
    const html = render({ comments: [comment({ content: '<b>gras</b> et <script>x</script>' })] });
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('gras et x');
  });

  it('affiche l’état vide quand le studio n’a rendu aucune note visible', () => {
    const html = render({ comments: [] });
    expect(html).not.toContain('Trop sombre');
    expect(html).toContain('<p');
  });
});
