// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role } from '../types/api';
import { intlLocale } from '../i18n';
// Même repli que la palette : le module est déjà pur et testé, le dupliquer ici
// ferait diverger deux définitions de « insensible aux accents ».
import { foldForSearch } from '../components/palette/paletteMatch';

/**
 * Choisir une personne dans l'annuaire — filtrage, tri et ligne d'identité.
 *
 * Un studio aligne des dizaines de comptes dont beaucoup portent le même nom d'affichage
 * (vingt-sept « IT Artist » d'affilée, observés en production) : la seule liste de noms ne
 * dit pas lequel est le bon. Deux réponses, toutes deux ici parce qu'elles sont pures et
 * doivent être testées : la recherche porte sur tout ce qui identifie quelqu'un (nom,
 * adresse, poste, rôle), et la ligne secondaire affiche ce qui départage — le poste et
 * l'adresse, qui, elle, est unique par construction.
 */

/** Une personne proposée au choix. Ce qu'il faut pour la reconnaître, rien de plus. */
export interface PersonOption {
  id: number;
  /** Nom affiché, déjà résolu par l'appelant (cf. `personLabel`). */
  name: string;
  /** Adresse : le seul champ qui départage deux homonymes à coup sûr. */
  email?: string | null;
  /** Poste déclaré sur la fiche (« Compositing lead »), quand il existe. */
  jobTitle?: string | null;
  /** Rôle dans le studio ou sur le projet — affiché en pastille. */
  role?: Role | null;
  avatarUrl?: string | null;
  /** Initiales calculées par le serveur ; à défaut, l'appelant les dérive du nom. */
  initials?: string;
  /** Compte machine (token d'API) : jamais proposé à moins qu'on l'exige. */
  isService?: boolean;
}

export interface PeopleFilterOptions {
  /** Saisie de l'utilisateur — casse, accents et espaces de bord ignorés. */
  query?: string;
  /** Personnes déjà retenues ailleurs (membres du projet, destinataires du fil). */
  excludeIds?: readonly number[];
  /** Laisse passer les comptes de service (aucun écran ne le demande aujourd'hui). */
  includeService?: boolean;
}

/** Identité brute telle qu'elle arrive de l'API, avant résolution du nom d'affichage. */
export interface PersonIdentity {
  displayName?: string | null;
  username?: string | null;
  name?: string | null;
  email: string;
}

/**
 * Nom d'affichage d'un compte.
 *
 * Le serveur calcule déjà `displayName` (pseudo > nom > prénom+nom > adresse) et l'envoie
 * sur la plupart des routes ; le repli couvre les vues qui ne le portent pas encore. Un
 * compte invité mais jamais renseigné n'a que son adresse : c'est elle qui s'affiche,
 * plutôt qu'une ligne vide qu'on ne saurait pas cliquer.
 */
export function personLabel(user: PersonIdentity): string {
  return user.displayName ?? user.username ?? user.name ?? user.email;
}

/** Ce qui départage deux homonymes, en une ligne : le poste puis l'adresse. */
export function personSubtitle(person: PersonOption): string {
  return [person.jobTitle, person.email].filter((part): part is string => Boolean(part)).join(' · ');
}

/**
 * La personne correspond-elle à la saisie ?
 *
 * Le rôle est comparé sur sa valeur technique (`ARTIST`) et non sur son libellé traduit :
 * comme les clés de la palette, elle ne bouge pas d'une langue à l'autre, et « admin »
 * reste ce que tape quelqu'un qui cherche un administrateur.
 */
export function personMatches(person: PersonOption, query: string): boolean {
  const needle = foldForSearch(query.trim());
  if (!needle) return true;
  return [person.name, person.email, person.jobTitle, person.role]
    .filter((part): part is string => Boolean(part))
    .some((part) => foldForSearch(part).includes(needle));
}

/**
 * Candidats retenus, triés pour la lecture.
 *
 * Le tri secondaire par adresse n'est pas cosmétique : sur une liste d'homonymes, c'est
 * le seul ordre stable — sans lui, deux « IT Artist » changent de place d'un rendu à
 * l'autre et on clique sur le mauvais.
 */
export function filterPeople(
  people: readonly PersonOption[],
  { query = '', excludeIds = [], includeService = false }: PeopleFilterOptions = {},
): PersonOption[] {
  const excluded = new Set(excludeIds);
  const locale = intlLocale();
  return people
    .filter((person) => includeService || !person.isService)
    .filter((person) => !excluded.has(person.id))
    .filter((person) => personMatches(person, query))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, locale) ||
        (a.email ?? '').localeCompare(b.email ?? '', locale) ||
        a.id - b.id,
    );
}

/**
 * Lequel des deux vides annoncer ?
 *
 * Une liste vide ne dit pas la même chose selon qu'on a cherché ou non. « Personne ne
 * correspond à cette recherche » sur un champ vide accuse une recherche qui n'a pas eu
 * lieu : ce qu'il faut dire, c'est qu'il n'y a personne à proposer — et cela, seul
 * l'appelant le sait (tout le studio est déjà membre, l'entité n'a aucun département…).
 * Dès qu'un mot est tapé, en revanche, c'est bien de correspondance qu'il s'agit.
 */
export function emptyPeopleReason(query: string): 'no-candidates' | 'no-match' {
  return query.trim() === '' ? 'no-candidates' : 'no-match';
}
