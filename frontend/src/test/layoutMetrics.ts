// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mise en page simulée, pour les composants qui MESURENT.
 *
 * happy-dom ne met rien en page : `scrollHeight` et `clientHeight` valent zéro sur tout
 * l'arbre. Un composant qui décide d'après son propre débordement — le repliage des
 * commentaires, qui a cessé d'estimer à partir du nombre de caractères — ne constate donc
 * rien, et un test qui s'en tient au DOM nu ne vérifie plus ce qu'il annonce.
 *
 * Le bouchon prête au document la métrique la plus simple qui reproduise le défaut : une
 * largeur en CARACTÈRES par ligne, une hauteur de ligne fixe, et le plafond que déclarent les
 * classes de repliage (`line-clamp-N`, `max-h-32`). C'est la largeur qui change d'une surface
 * à l'autre — une carte ancrée de 15 rem contre le fil de commentaires — et c'est exactement
 * ce qu'une constante de caractères ne pouvait pas distinguer.
 *
 * Ce n'est pas un moteur de rendu : les mots ne se coupent qu'au caractère, et seules les deux
 * classes de repliage de l'application plafonnent une hauteur. Un test qui aurait besoin de
 * plus devrait passer par le navigateur.
 */

/** Hauteur d'une ligne, en pixels : une valeur ronde, pour que les comptes se lisent. */
export const STUB_LINE_HEIGHT = 16;

/** Hauteur visible du repliage par défaut (`max-h-32`), en pixels. */
const MAX_H_32 = 128;

/** Plafond de hauteur déclaré par les classes de repliage, ou `null` si l'élément n'en a pas. */
function heightCap(el: Element, lineHeight: number): number | null {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/);
  const clamp = classes.find((c) => /^line-clamp-\d+$/.test(c));
  if (clamp) return Number(clamp.slice('line-clamp-'.length)) * lineHeight;
  return classes.includes('max-h-32') ? MAX_H_32 : null;
}

/** Lignes qu'occupe un texte à cette largeur, sauts de ligne compris. */
function wrappedLines(text: string, charsPerLine: number): number {
  return text
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/**
 * Installe la métrique et rend la fonction qui la retire. À appeler AVANT le rendu : la
 * mesure se fait dans un effet de mise en page, donc pendant le rendu.
 */
export function stubLayoutMetrics({
  charsPerLine,
  lineHeight = STUB_LINE_HEIGHT,
}: {
  charsPerLine: number;
  lineHeight?: number;
}): () => void {
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element): number {
      return wrappedLines(this.textContent ?? '', charsPerLine) * lineHeight;
    },
  });
  // Sans plafond, l'élément montre tout son contenu : c'est le cas de tout l'arbre sauf le
  // seul élément replié, et c'est ce qui fait que lui seul est mesuré comme débordant.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      const cap = heightCap(this, lineHeight);
      return cap === null ? this.scrollHeight : Math.min(this.scrollHeight, cap);
    },
  });

  return () => {
    if (scrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight);
    if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  };
}
