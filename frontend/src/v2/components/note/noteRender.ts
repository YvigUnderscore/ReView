// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Marked } from 'marked';
import { isUnsafeHref, isUnsafeSrc } from '../../pages/docs/docsRender';
import { isNoteImageKey, parseImageOptions } from './noteMarkdown';

/**
 * Rendu du markdown d'une fiche d'entité.
 *
 * Distinct de `renderDocHtml` : la documentation réécrit les liens internes du dépôt,
 * retire un préambule et traduit des encarts — rien de tout cela n'a de sens pour un brief
 * de plan. Ce qui est commun, en revanche, ce sont les deux garde-fous, et ils sont repris
 * tels quels : le **HTML brut est échappé** (le serveur stocke du texte, il n'assainit rien)
 * et les protocoles exécutables sont retirés des liens comme des images.
 *
 * Une fiche est écrite par un superviseur, pas par un inconnu — mais « écrite par quelqu'un
 * de confiance » n'a jamais empêché un copier-coller depuis un site quelconque.
 *
 * Deux choses s'ajoutent ici, que le markdown ne sait pas dire seul : la **disposition**
 * d'une image (portée par son titre, cf. `noteMarkdown`) et la **résolution des clés** —
 * une fiche enregistre `note-images/shot/12/…`, jamais une URL présignée, qui aurait expiré
 * bien avant qu'on relise le brief.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: { text: string }) {
      return escapeHtml(text);
    },
  },
});

/** Transforme une clé de stockage en URL affichable ; rend `undefined` si elle est inconnue. */
export type ImageResolver = (src: string) => string | undefined;

/**
 * Markdown → HTML assaini.
 *
 * L'assainissement passe par le DOM plutôt que par des expressions sur la chaîne : c'est le
 * navigateur qui décide ce qu'est un attribut `href`, et lui seul sait le faire fidèlement.
 */
export function renderNoteHtml(markdown: string, resolve?: ImageResolver): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = md.parse(markdown, { async: false });

  for (const a of tpl.content.querySelectorAll('a[href]')) {
    if (isUnsafeHref(a.getAttribute('href') ?? '')) a.removeAttribute('href');
    else {
      // Une fiche renvoie vers l'extérieur (une planche, un document de production) : le
      // lien s'ouvre à côté, et `noreferrer` évite de livrer l'adresse de l'instance.
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer');
    }
  }
  for (const img of tpl.content.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src') ?? '';
    if (isUnsafeSrc(src)) {
      img.remove();
      continue;
    }
    // Le titre porte la disposition ; il ne doit pas finir en infobulle sous le curseur.
    const options = parseImageOptions(img.getAttribute('title') ?? undefined);
    img.removeAttribute('title');
    img.setAttribute('data-align', options.align);
    if (options.width !== 100) img.setAttribute('style', `width:${options.width}%`);

    const resolved = resolve?.(src);
    if (resolved) img.setAttribute('src', resolved);
    else if (isNoteImageKey(src)) {
      // La clé n'a pas encore son URL (résolution en cours, ou projet fermé au lecteur) :
      // laisser le `src` tel quel afficherait une icône d'image cassée, ce qui se lit comme
      // « la planche a été perdue ». Un cadre vide dit mieux ce qui se passe.
      const placeholder = tpl.ownerDocument.createElement('span');
      placeholder.setAttribute('data-note-image-pending', '');
      placeholder.setAttribute('style', img.getAttribute('style') ?? '');
      img.replaceWith(placeholder);
      continue;
    }
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  }
  return tpl.innerHTML;
}
