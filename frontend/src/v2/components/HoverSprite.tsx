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
 */
export default function HoverSprite({ sprite }: { sprite: SpriteData }) {
  const [hovered, setHovered] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!hovered) return;
    const t = window.setInterval(() => setFrame((f) => (f + 1) % sprite.count), 180);
    return () => window.clearInterval(t);
  }, [hovered, sprite.count]);

  const col = frame % sprite.cols;
  const row = Math.floor(frame / sprite.cols);
  // Position en % (0→100) pour que chaque tuile remplisse la carte quelle que soit sa taille.
  const posX = sprite.cols > 1 ? (col / (sprite.cols - 1)) * 100 : 0;
  const posY = sprite.rows > 1 ? (row / (sprite.rows - 1)) * 100 : 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setFrame(0);
      }}
      aria-hidden
      className="absolute inset-0 transition-opacity duration-150"
      style={{
        opacity: hovered ? 1 : 0,
        backgroundImage: `url(${sprite.url})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${sprite.cols * 100}% ${sprite.rows * 100}%`,
        backgroundPosition: `${posX}% ${posY}%`,
      }}
    />
  );
}
