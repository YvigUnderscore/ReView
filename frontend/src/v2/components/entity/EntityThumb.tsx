// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { thumbAbbrev, thumbScale } from '../../lib/entityThumbLabel';

/**
 * Vignette d'un élément : son image, et son **nom** tant qu'aucune image n'existe.
 *
 * Un projet neuf, une séquence qu'on vient de créer, deux cents plans importés d'un CSV :
 * les grilles affichaient la même icône d'image grise répétée, si bien que rien ne
 * distinguait une carte d'une autre avant d'en lire le titre, plus bas et plus petit. Le
 * nom devient donc l'image par défaut — c'est la seule chose qu'on sache de l'élément
 * avant son premier média, et c'est déjà ce qu'on cherche du regard.
 *
 * Le repli s'efface de lui-même : la miniature effective est résolue côté serveur
 * (`backend/src/lib/thumbnails.ts`), qui retombe sur celle du premier média publié de
 * l'élément dès qu'une image parvient.
 */
export interface EntityThumbProps {
  /** Miniature effective, si l'élément en a une (vignette choisie ou premier média). */
  url?: string | null;
  /** Nom de l'élément — c'est lui l'image par défaut. */
  name: string;
  /** `card` : le nom en entier ; `mini` : son abrégé, sous 40 px de côté. */
  variant?: 'card' | 'mini';
  /** Classes de l'appelant (transitions au survol, arrondis…) — image comme repli. */
  className?: string;
}

export default function EntityThumb({ url, name, variant = 'card', className = '' }: EntityThumbProps) {
  if (url) {
    // Chargement paresseux : une grille de cent plans demandait cent JPEG de 640 px dès
    // le montage (4 à 8 Mo) pour n'en afficher qu'une douzaine à l'écran.
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }

  const label = variant === 'mini' ? thumbAbbrev(name) : name;
  return (
    // `aria-hidden` : le nom est déjà porté par le titre de la carte ou de la page — le
    // répéter ferait dire deux fois la même chose au lecteur d'écran.
    <span
      aria-hidden="true"
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 to-secondary/60 px-1.5 text-center font-semibold leading-tight text-foreground/70 ${
        variant === 'mini' ? 'text-2xs' : thumbScale(label)
      } ${className}`}
    >
      <span className="line-clamp-3 break-words">{label}</span>
    </span>
  );
}
