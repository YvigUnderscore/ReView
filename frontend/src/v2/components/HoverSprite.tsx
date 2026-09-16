// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

/** Sprite de miniatures : grille `cols`×`rows`, `count` vignettes (42.A — №78). */
export interface SpriteData {
  url: string;
  count: number;
  cols: number;
  rows: number;
}

/**
 * Aperçu animé au survol (42.A — №78) : superpose la carte et fait défiler les vignettes
 * du sprite tant que la souris est dessus. Transparent au repos → laisse voir la miniature
 * statique en dessous. Se pilote seul (il est au-dessus, donc reçoit le survol).
 *
 * La mosaïque n'entre dans le style **qu'après** un premier survol. Un fond CSS est
 * téléchargé dès que l'élément entre dans l'arbre de rendu — `opacity: 0` ne diffère rien,
 * seul `display: none` le ferait : une page de cent cartes réclamait cent planches-contact
 * de plusieurs centaines de kilo-octets pour un survol qui n'aurait peut-être jamais lieu,
 * et annulait le `loading="lazy"` posé juste à côté sur la miniature statique.
 */
export default function HoverSprite({ sprite }: { sprite: SpriteData }) {
  const [hovered, setHovered] = useState(false);
  const [frame, setFrame] = useState(0);
  // Armé au premier survol, et jamais désarmé : le second survol doit être instantané.
  const [armed, setArmed] = useState(false);
  // On ne dévoile la mosaïque qu'une fois décodée. Poser l'URL avant ferait apparaître
  // l'image par bandes sous le fondu, là où l'ancien code la tenait prête d'avance.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!armed) return;
    // Préchargement hors du DOM : c'est LA requête réseau de la mosaïque. Le fond CSS
    // posé ensuite tape dans le cache du navigateur, il n'en déclenche pas de seconde.
    const img = new Image();
    const reveal = () => setReady(true);
    img.addEventListener('load', reveal);
    img.src = sprite.url;
    return () => img.removeEventListener('load', reveal);
  }, [armed, sprite.url]);

  useEffect(() => {
    if (!hovered || !ready) return;
    const t = window.setInterval(() => setFrame((f) => (f + 1) % sprite.count), 180);
    return () => window.clearInterval(t);
  }, [hovered, ready, sprite.count]);

  const col = frame % sprite.cols;
  const row = Math.floor(frame / sprite.cols);
  // Position en % (0→100) pour que chaque tuile remplisse la carte quelle que soit sa taille.
  const posX = sprite.cols > 1 ? (col / (sprite.cols - 1)) * 100 : 0;
  const posY = sprite.rows > 1 ? (row / (sprite.rows - 1)) * 100 : 0;
  const shown = hovered && ready;

  return (
    <div
      onMouseEnter={() => {
        setArmed(true);
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setFrame(0);
      }}
      aria-hidden
      className="absolute inset-0 transition-opacity duration-150"
      style={{
        opacity: shown ? 1 : 0,
        backgroundImage: ready ? `url(${sprite.url})` : undefined,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${sprite.cols * 100}% ${sprite.rows * 100}%`,
        backgroundPosition: `${posX}% ${posY}%`,
      }}
    />
  );
}
