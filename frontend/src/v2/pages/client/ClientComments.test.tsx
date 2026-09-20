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
  duration: null,
  guestName: 'Client',
  author: null,
  createdAt: '2026-08-21T10:00:00.000Z',
  isEdited: false,
  annotation: null,
  ...patch,
});

const wall = 'z'.repeat(700);

const render = (props: Partial<Parameters<typeof ClientComments>[0]> = {}) =>
  renderToStaticMarkup(
    <ClientComments
      comments={[comment()]}
      canComment={false}
      timed
      fps={24}
      startFrame={1001}
      selectedId={null}
      hasAnnotation={false}
      guestName=""
      onGuestName={vi.fn()}
      onSelect={vi.fn()}
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

/**
 * Les outils de dessin vivent SOUS le champ de commentaire, là où la review interne met les
 * siens — et pas au-dessus de l'image, où ils repoussaient le média qu'ils servent.
 */
describe('ClientComments — les outils et le dessin seul', () => {
  it('pose la barre d’outils dans le composeur, pas ailleurs', () => {
    const html = render({ canComment: true, annotationBar: <div data-testid="tools" /> });
    const form = html.slice(html.indexOf('<form'));
    expect(form).toContain('data-testid="tools"');
  });

  it('n’offre aucun outil sur un lien en lecture seule', () => {
    expect(render({ canComment: false, annotationBar: <div data-testid="tools" /> })).not.toContain(
      'data-testid="tools"',
    );
  });

  /**
   * Le serveur exige un contenu, mais un dessin en tient lieu : le bouton d'envoi doit
   * s'ouvrir sur le seul dessin. On vise l'ATTRIBUT `disabled=""` et non le mot — il figure
   * aussi dans les classes utilitaires (`disabled:opacity-50`), qui sont là en permanence.
   */
  it('laisse envoyer un dessin sans texte, et refuse le vide', () => {
    expect(render({ canComment: true, hasAnnotation: true })).not.toContain('disabled=""');
    expect(render({ canComment: true, hasAnnotation: false })).toContain('disabled=""');
  });
});

/**
 * Le portail n'affichait AUCUNE pièce jointe : une image jointe par le studio arrivait
 * invisible chez son destinataire. Les URL sont présignées côté serveur — la clé MinIO ne
 * descend pas, et il n'y a donc rien à reconstruire ici.
 */
describe('ClientComments — pièces jointes du studio', () => {
  const withImage = () =>
    comment({
      attachments: [{ name: 'planche.png', contentType: 'image/png', url: 'https://minio/planche' }],
    });

  it('affiche la vignette d’une image jointe', () => {
    const html = render({ comments: [withImage()] });
    expect(html).toContain('https://minio/planche');
    expect(html).toContain('planche.png');
  });

  it('n’ajoute aucune vignette à une note sans pièce jointe', () => {
    expect(render()).not.toContain('<img');
  });
});

/** Une note trop grande s'ouvre repliée — mais son texte reste dans la page, donc trouvable. */
describe('ClientComments — note trop grande', () => {
  it('pose un indicateur de dépliage et conserve le texte entier', () => {
    const html = render({ timed: false, comments: [comment({ content: wall, timestamp: null })] });
    expect(html).toContain(wall);
    expect(html).toContain('<button');
  });

  it('ne replie pas une note courte', () => {
    expect(render({ timed: false, comments: [comment({ timestamp: null })] })).not.toContain('<button');
  });
});
