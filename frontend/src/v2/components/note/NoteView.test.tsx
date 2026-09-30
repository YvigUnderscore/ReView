// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NoteView from './NoteView';
import { renderNoteHtml } from './noteRender';

/**
 * Le rendu d'une fiche.
 *
 * `parseNote` est testé à part ; ce qui se joue ici, c'est ce que le lecteur voit — et
 * surtout ce qu'il ne doit jamais voir : du HTML venu d'un copier-coller.
 */
describe('NoteView', () => {
  it('ne rend rien pour une fiche vide', () => {
    expect(renderToStaticMarkup(<NoteView source="" />)).toBe('');
  });

  it('rend une jauge accessible, avec sa valeur', () => {
    const html = renderToStaticMarkup(<NoteView source="::progress Animation 60" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain('Animation');
    expect(html).toContain('60%');
  });

  it('replie une section marquée comme telle, et n’en rend pas le contenu', () => {
    const open = renderToStaticMarkup(<NoteView source={'## Brief\nle texte'} />);
    const closed = renderToStaticMarkup(<NoteView source={'##- Brief\nle texte'} />);
    expect(open).toContain('le texte');
    expect(closed).not.toContain('le texte');
    expect(closed).toContain('aria-expanded="false"');
  });

  it('affiche le carrousel avec son compteur', () => {
    const html = renderToStaticMarkup(<NoteView source={'::refs\n![Une](a.jpg)\n![Deux](b.jpg)\n::end'} />);
    expect(html).toContain('src="a.jpg"');
    expect(html).toContain('1 / 2');
  });

  it('pose une planche : toutes les images à la fois, à la hauteur demandée', () => {
    const html = renderToStaticMarkup(
      <NoteView source={'::refs grid cols=2 h=120\n![Une](a.jpg)\n![Deux](b.jpg)\n::end'} />,
    );
    expect(html).toContain('src="a.jpg"');
    expect(html).toContain('src="b.jpg"');
    // La planche montre tout : pas de compteur, il n'y a rien à feuilleter.
    expect(html).not.toContain('1 / 2');
    expect(html).toContain('height:120px');
  });
});

describe('renderNoteHtml — disposition des images', () => {
  it('sort la disposition du titre markdown pour ne pas la laisser en infobulle', () => {
    const html = renderNoteHtml('![ref](a.jpg "align=left width=40")');
    expect(html).toContain('data-align="left"');
    expect(html).toContain('width:40%');
    expect(html).not.toContain('title=');
  });

  it('laisse pleine largeur ce qui n’a rien demandé', () => {
    const html = renderNoteHtml('![ref](a.jpg)');
    expect(html).toContain('data-align="full"');
    expect(html).not.toContain('style=');
  });
});

describe('renderNoteHtml — images de la fiche', () => {
  const KEY = 'note-images/shot/12/1700-planche.png';

  it('remplace la clé enregistrée par l’URL de lecture', () => {
    const html = renderNoteHtml(`![ref](${KEY})`, (src) =>
      src === KEY ? 'https://minio/signed' : undefined,
    );
    expect(html).toContain('src="https://minio/signed"');
  });

  it('pose un cadre tant que l’URL n’est pas là — jamais une image cassée', () => {
    const html = renderNoteHtml(`![ref](${KEY})`);
    expect(html).not.toContain('<img');
    expect(html).toContain('data-note-image-pending');
  });

  it('n’attend aucune résolution pour une image restée à l’extérieur', () => {
    expect(renderNoteHtml('![ref](https://studio.test/a.jpg)')).toContain('src="https://studio.test/a.jpg"');
  });
});

describe('renderNoteHtml — garde-fous', () => {
  it('échappe le HTML brut : le serveur ne stocke que du texte', () => {
    const html = renderNoteHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('retire un lien à protocole exécutable, sans perdre le texte', () => {
    const html = renderNoteHtml('[clic](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('clic');
  });

  it('ouvre les liens externes à côté, sans livrer l’adresse de l’instance', () => {
    const html = renderNoteHtml('[doc](https://studio.test/brief)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('supprime une image à protocole exécutable', () => {
    expect(renderNoteHtml('![x](javascript:alert(1))')).not.toContain('<img');
  });

  it('charge les images paresseusement — un brief en porte une planche entière', () => {
    const html = renderNoteHtml('![ref](https://studio.test/a.jpg)');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
