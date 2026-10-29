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
  it('only reports the French messages that are thrown', () => {
    const source = [
      `throw notFound('Shot not found');`,
      `// Séquence introuvable : commentaire, personne ne le lit à l'écran`,
      `throw badRequest('Fichier trop volumineux');`,
    ].join('\n');
    expect(offendersOf(source)).toEqual([{ line: 3, text: 'Fichier trop volumineux' }]);
  });
});
