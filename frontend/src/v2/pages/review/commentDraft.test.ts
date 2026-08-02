// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { loadDraft, saveDraft, clearDraft } from './commentDraft';

describe('commentDraft (32.C)', () => {
  beforeEach(() => localStorage.clear());

  it('retourne null sans brouillon', () => {
    expect(loadDraft(1)).toBeNull();
  });

  it('sauvegarde et recharge un brouillon par média', () => {
    saveDraft(1, { content: 'à reprendre' });
    saveDraft(2, { content: 'autre média' });
    expect(loadDraft(1)).toEqual({ content: 'à reprendre' });
    expect(loadDraft(2)).toEqual({ content: 'autre média' });
  });

  it('fusionne texte et formes sans écraser l’autre champ', () => {
    saveDraft(1, { content: 'texte' });
    saveDraft(1, { shapes: [{ id: 'a' }] });
    expect(loadDraft(1)).toEqual({ content: 'texte', shapes: [{ id: 'a' }] });
  });

  it('supprime l’entrée quand le brouillon devient vide', () => {
    saveDraft(1, { content: 'texte', shapes: [{ id: 'a' }] });
    saveDraft(1, { content: '', shapes: [] });
    expect(localStorage.getItem('review-draft-1')).toBeNull();
    expect(loadDraft(1)).toBeNull();
  });

  it('ignore un brouillon corrompu', () => {
    localStorage.setItem('review-draft-1', '{pas du json');
    expect(loadDraft(1)).toBeNull();
  });

  it('clearDraft purge le brouillon', () => {
    saveDraft(1, { content: 'x' });
    clearDraft(1);
    expect(loadDraft(1)).toBeNull();
  });
});
