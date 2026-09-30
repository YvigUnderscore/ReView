// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { looksFrench, messagesOf, offendersOf } from './check-backend-english.mjs';

describe('messagesOf', () => {
  it('relève le message, pas le code d’erreur qui le suit', () => {
    const found = messagesOf(`throw badRequest('Filename is invalid', 'BAD_NAME');`);
    expect(found).toEqual([{ line: 1, text: 'Filename is invalid' }]);
  });

  it('couvre toutes les façons de lever une erreur lue par un humain', () => {
    const source = [
      `throw notFound('Shot not found');`,
      `throw forbidden('Administrators only');`,
      `throw conflict('Already exists');`,
      `throw new Error('Conversion failed');`,
    ].join('\n');
    expect(messagesOf(source)).toHaveLength(4);
  });

  it('ignore une ligne qui ne lève rien', () => {
    expect(messagesOf(`const label = 'Séquence introuvable';`)).toEqual([]);
  });
});

describe('looksFrench', () => {
  it('reconnaît le français à ses accents', () => {
    expect(looksFrench('Séquence non trouvée')).toBe(true);
  });

  it('le reconnaît aussi sans accent — c’est là qu’il se cache', () => {
    // « Media introuvable » n'a pas un seul accent et reste du français.
    expect(looksFrench('Media introuvable')).toBe(true);
    expect(looksFrench('Chemin trop long')).toBe(true);
  });

  it('laisse passer l’anglais technique, mot-outil isolé compris', () => {
    // « non-HTTP » contient « non » : un seul mot faible ne suffit pas à conclure.
    expect(looksFrench('Webhook URL refused (private host, or a non-HTTP scheme)')).toBe(false);
    expect(looksFrench('Only a supervisor can publish a version')).toBe(false);
    expect(looksFrench('Path is too deep')).toBe(false);
  });

  it('conclut sur deux mots-outils français, même sans accent', () => {
    expect(looksFrench('Le shot est dans la corbeille')).toBe(true);
  });
});

describe('offendersOf', () => {
  it('ne rapporte que les messages français levés', () => {
    const source = [
      `throw notFound('Shot not found');`,
      `// Séquence introuvable : commentaire, personne ne le lit à l'écran`,
      `throw badRequest('Fichier trop volumineux');`,
    ].join('\n');
    expect(offendersOf(source)).toEqual([{ line: 3, text: 'Fichier trop volumineux' }]);
  });
});
