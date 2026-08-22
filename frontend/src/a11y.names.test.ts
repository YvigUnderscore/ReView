// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Champs de saisie **sans nom accessible** — mesure et cliquet.
 *
 * Un `<select>` posé nu s'annonce « liste déroulante » et rien d'autre : sur une page de
 * kanban, où chaque carte porte son sélecteur de statut, un lecteur d'écran énumère des
 * contrôles indiscernables. `jsx-a11y` ne le voit pas : `label-has-associated-control`
 * n'agit que s'il existe déjà un `<label>`, et `control-has-associated-label` appartient au
 * preset strict, non activé.
 *
 * Le contrôle est syntaxique — pas de rendu, pas d'arbre d'accessibilité : il relève les
 * balises de saisie qui n'ont **aucune** source de nom (`aria-label`, `aria-labelledby`,
 * `title`, `id` associé, libellé englobant, ou props transmises par une primitive). Le
 * total est comparé à un plafond, à baisser quand on descend et jamais à relever.
 */

/**
 * Reliquat de champs anonymes toléré — dette chiffrée, à faire descendre jusqu'à 0 et
 * jamais à relever. Vingt-quatre au 2026-08-22, tous dans des panneaux d'administration
 * ou ShotGrid ; le sélecteur de statut du kanban, lui, est nommé (test suivant).
 */
const CEILING = 24;

const FIELDS = new Set(['input', 'select', 'textarea']);

/**
 * Attributs qui donnent, ou transmettent, un nom accessible. `title` et `placeholder`
 * comptent : l'algorithme accname les retient en dernier recours. Nom médiocre, donc,
 * mais pas nom absent — le contrôle vise l'anonymat complet, la seule faute franche.
 */
const NAMING_ATTRS = new Set(['aria-label', 'aria-labelledby', 'id', 'title', 'placeholder']);

/** Éléments dont le contenu est libellé : le `<label>` englobant nomme son contrôle. */
const LABELLING_TAGS = /^(label|Label|.*Field|Field)$/;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) yield full;
  }
}

const tagOf = (node: ts.JsxSelfClosingElement | ts.JsxOpeningElement) => node.tagName.getText();

/** Le contrôle est-il englobé par un libellé (motif `Field`, `<label>…</label>`) ? */
function insideLabel(node: ts.Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxElement(cur) && LABELLING_TAGS.test(cur.openingElement.tagName.getText())) return true;
  }
  return false;
}

function isAnonymous(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement): boolean {
  let hidden = false;
  for (const attr of node.attributes.properties) {
    // `{...props}` : une primitive transmet le nom que lui donne l'appelant.
    if (ts.isJsxSpreadAttribute(attr)) return false;
    if (!ts.isJsxAttribute(attr)) continue;
    const name = attr.name.getText();
    if (NAMING_ATTRS.has(name)) return false;
    // `type="hidden"`, et le sélecteur de fichier caché derrière un bouton
    // (`className="hidden"`) : `display: none` les sort de l'arbre d'accessibilité,
    // c'est le bouton visible qui porte le nom.
    if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
      if (name === 'type' && attr.initializer.text === 'hidden') hidden = true;
      if (name === 'className' && /\bhidden\b/.test(attr.initializer.text)) hidden = true;
    }
  }
  return !hidden && !insideLabel(node);
}

/** Champs anonymes du frontend, `fichier:ligne` et balise. */
function anonymousFields(root = 'src'): string[] {
  const found: string[] = [];
  for (const file of sources(root)) {
    const src = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && FIELDS.has(tagOf(node))) {
        if (isAnonymous(node)) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
          found.push(`${file.split(/[\\/]/).join('/')}:${line + 1} <${tagOf(node)}>`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return found;
}

describe('noms accessibles des champs de saisie', () => {
  it('ne laisse pas remonter le nombre de champs anonymes', () => {
    const found = anonymousFields();
    expect(found.length, `champs sans nom accessible :\n${found.join('\n')}`).toBeLessThanOrEqual(CEILING);
  });

  it('nomme le sélecteur de statut, présent sur chaque carte de kanban', () => {
    const source = readFileSync('src/v2/components/shotgrid/PipelineStatusSelect.tsx', 'utf8');
    // Deux `<select>` : le référentiel du projet et le repli sur l'énumération figée.
    expect(source.match(/aria-label=/g)).toHaveLength(2);
  });
});

describe('détection', () => {
  it('reconnaît les sources de nom et les absences', () => {
    const parse = (source: string) =>
      ts.createSourceFile('T.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const firstField = (source: string) => {
      let found: ts.JsxSelfClosingElement | undefined;
      const visit = (node: ts.Node): void => {
        if (!found && ts.isJsxSelfClosingElement(node) && FIELDS.has(tagOf(node))) found = node;
        ts.forEachChild(node, visit);
      };
      visit(parse(source));
      return found!;
    };

    expect(isAnonymous(firstField('const A = () => <select />;'))).toBe(true);
    expect(isAnonymous(firstField('const A = () => <select aria-label="Status" />;'))).toBe(false);
    expect(isAnonymous(firstField('const A = (p) => <input {...p} />;'))).toBe(false);
    expect(isAnonymous(firstField('const A = () => <input type="hidden" />;'))).toBe(false);
    expect(isAnonymous(firstField('const A = () => <label>Name<input /></label>;'))).toBe(false);
  });
});
