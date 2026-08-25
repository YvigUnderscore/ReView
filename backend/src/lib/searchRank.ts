// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ce qui doit remonter en premier.
 *
 * La recherche rendait dix listes, chacune dans l'ordre de la base — le plus récent
 * d'abord. Taper « SH0120 » plaçait donc le plan SH0120 après trois médias dont le nom de
 * fichier contient « sh0120 », et l'ordre changeait à chaque publication. Ce n'est pas un
 * classement, c'est une chronologie.
 *
 * Le score répond à une question simple : **à quel point ce résultat est-il ce que
 * l'utilisateur a tapé ?** Quatre degrés, du plus net au plus vague — l'égalité, le début,
 * le mot entier, le fragment quelque part. Le champ compte ensuite : trouver « pluie » dans
 * le code d'un plan est plus fort que le trouver au milieu d'un brief de trente lignes.
 *
 * Pur et sans dépendance : le classement se teste sans base, et deux appelants ne peuvent
 * pas en donner deux versions.
 */

/** Où la correspondance a été trouvée — du plus identifiant au plus bavard. */
export type MatchField = 'code' | 'name' | 'description' | 'body';

/**
 * Deux échelles, et leur ordre compte.
 *
 * La **qualité** de la correspondance pèse lourd, le **champ** départage. C'est le bon sens
 * de lecture : « ce que j'ai tapé, trouvé tel quel » prime sur « où ça a été trouvé ». À
 * l'inverse — champ en poids fort — un fragment perdu au milieu d'un code aurait battu un
 * mot trouvé exactement dans une description, ce qui donne des premiers résultats que
 * personne ne reconnaît.
 */
const QUALITY = { exact: 400, prefix: 300, word: 200, contains: 100 } as const;

/** Départage : un code identifie, un corps de texte évoque. */
const FIELD_WEIGHT: Record<MatchField, number> = {
  code: 40,
  name: 30,
  description: 20,
  body: 10,
};

/**
 * Normalisation : minuscules et accents retirés.
 *
 * « Poursuite » et « poursuite » désignent la même chose, et un artiste tape rarement les
 * accents dans un champ de recherche. Sans cette normalisation, « heros » ne trouvait pas
 * « héros » — ce qui donne l'impression que la recherche ne marche pas.
 */
export function normalise(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Score d'une correspondance dans un champ donné. `null` quand la valeur ne correspond
 * pas du tout — l'appelant sait alors qu'il n'a rien à classer.
 */
export function fieldScore(
  value: string | null | undefined,
  query: string,
  field: MatchField,
): number | null {
  if (!value) return null;
  const haystack = normalise(value);
  const needle = normalise(query).trim();
  if (!needle) return null;
  const at = haystack.indexOf(needle);
  if (at === -1) return null;

  const quality =
    haystack === needle
      ? QUALITY.exact
      : at === 0
        ? QUALITY.prefix
        : // Début de mot : « pluie » dans « sous la pluie » vaut mieux que dans « parapluie ».
          /[\s._\-/]/.test(haystack[at - 1] ?? '')
          ? QUALITY.word
          : QUALITY.contains;
  return quality + FIELD_WEIGHT[field];
}

/** Le meilleur score parmi plusieurs champs — c'est celui qui classe le résultat. */
export function bestScore(
  query: string,
  fields: { value: string | null | undefined; field: MatchField }[],
): number {
  let best = 0;
  for (const { value, field } of fields) {
    const score = fieldScore(value, query, field);
    if (score !== null && score > best) best = score;
  }
  return best;
}

/**
 * Trie une liste par score décroissant, **en préservant l'ordre d'origine à égalité**.
 *
 * L'ordre d'origine est celui de la base — le plus récent d'abord. À score égal, c'est le
 * bon départage : entre deux plans qui correspondent aussi bien, celui qui a bougé
 * récemment est celui qu'on cherche.
 */
export function rankBy<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
