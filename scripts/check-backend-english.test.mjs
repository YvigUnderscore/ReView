// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { looksFrench, messagesOf, offendersOf } from './check-backend-english.mjs';

describe('messagesOf', () => {
  it('extracts the message, not the error code that follows it', () => {
    const found = messagesOf(`throw badRequest('Filename is invalid', 'BAD_NAME');`);
    expect(found).toEqual([{ line: 1, text: 'Filename is invalid' }]);
  });

  it('covers every way of throwing an error read by a human', () => {
    const source = [
      `throw notFound('Shot not found');`,
      `throw forbidden('Administrators only');`,
      `throw conflict('Already exists');`,
      `throw new Error('Conversion failed');`,
    ].join('\n');
    expect(messagesOf(source)).toHaveLength(4);
  });

  it('ignores a line that throws nothing', () => {
    expect(messagesOf(`const label = 'Séquence introuvable';`)).toEqual([]);
  });

  it('reads a message that Prettier wrapped onto the next line', () => {
    const source = [
      'throw badRequest(',
      "  'Fichier trop volumineux pour ce projet',",
      "  'TOO_BIG',",
      ');',
    ].join('\n');
    expect(messagesOf(source)).toEqual([{ line: 2, text: 'Fichier trop volumineux pour ce projet' }]);
  });

  it('reads template literals, interpolations blanked, apostrophes included', () => {
    const source = "throw new Error(`Chemin d'entrée refusé : ${entry.name} (${'x'})`);";
    expect(messagesOf(source)).toEqual([{ line: 1, text: "Chemin d'entrée refusé :   ( )" }]);
  });

  it('does not stop a double-quoted message at its apostrophe', () => {
    expect(messagesOf(`throw forbidden("Seul l'auteur peut éditer le contenu");`)).toEqual([
      { line: 1, text: "Seul l'auteur peut éditer le contenu" },
    ]);
  });

  it('reads the logger message, whatever the logger', () => {
    const source = [
      `logger.warn({ err }, '[redis] souscription échouée');`,
      `req.log.error({ err }, 'Erreur non gérée');`,
      `log.info(`,
      `  { runId },`,
      `  'Synchronisation terminée',`,
      `);`,
    ].join('\n');
    expect(messagesOf(source).map((m) => m.line)).toEqual([1, 2, 5]);
  });

  it('reads the message of any Error subclass', () => {
    expect(messagesOf(`throw new ShotgridApiError('Dépôt du fichier refusé', 502);`)).toEqual([
      { line: 1, text: 'Dépôt du fichier refusé' },
    ]);
  });

  it('reads a JSON error body written by hand', () => {
    const source = `res.status(403).json({ error: 'Scope write requis', code: 'SCOPE_WRITE_REQUIRED' });`;
    expect(messagesOf(source)).toEqual([{ line: 1, text: 'Scope write requis' }]);
  });

  it('skips error codes and the literals of a comment inside the call', () => {
    const source = [
      `throw conflict(`,
      `  // 'Déjà là' : commentaire`,
      `  'Already exists',`,
      `  'ALREADY_EXISTS',`,
      `);`,
    ].join('\n');
    expect(messagesOf(source)).toEqual([{ line: 3, text: 'Already exists' }]);
  });

  it('stops at the end of the call', () => {
    const source = `throw notFound('Shot not found'); const label = 'Séquence introuvable';`;
    expect(messagesOf(source)).toEqual([{ line: 1, text: 'Shot not found' }]);
  });
});

describe('looksFrench', () => {
  it('recognises French by its accents', () => {
    expect(looksFrench('Séquence non trouvée')).toBe(true);
  });

  it('also recognises it without accents — that is where it hides', () => {
    // "Media introuvable" has not a single accent and is still French.
    expect(looksFrench('Media introuvable')).toBe(true);
    expect(looksFrench('Chemin trop long')).toBe(true);
  });

  it('lets technical English through, isolated function word included', () => {
    // "non-HTTP" contains "non": a single weak word is not enough to conclude.
    expect(looksFrench('Webhook URL refused (private host, or a non-HTTP scheme)')).toBe(false);
    expect(looksFrench('Only a supervisor can publish a version')).toBe(false);
    expect(looksFrench('Path is too deep')).toBe(false);
  });

  it('concludes on two French function words, even without accents', () => {
    expect(looksFrench('Le shot est dans la corbeille')).toBe(true);
  });
});

describe('offendersOf', () => {
  it('flags a wrapped French throw and a French log, not their English neighbours', () => {
    const source = [
      `logger.info({ id }, 'Media uploaded to ShotGrid');`,
      `logger.info({ id }, 'Média envoyé vers ShotGrid');`,
      `throw badRequest(`,
      '  `Archive refusée : ${name}`,',
      `);`,
    ].join('\n');
    expect(offendersOf(source).map((o) => o.line)).toEqual([2, 4]);
  });

  it('only reports the French messages that are thrown', () => {
    const source = [
      `throw notFound('Shot not found');`,
      `// Séquence introuvable : commentaire, personne ne le lit à l'écran`,
      `throw badRequest('Fichier trop volumineux');`,
    ].join('\n');
    expect(offendersOf(source)).toEqual([{ line: 3, text: 'Fichier trop volumineux' }]);
  });
});
