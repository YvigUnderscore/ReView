import { describe, expect, it } from 'vitest';
import { pickPreselectedStatus, reviewStatusStyle } from './reviewDecision.helpers';

describe('reviewStatusStyle', () => {
  it('dérive texte/bordure/fond depuis la couleur hex', () => {
    expect(reviewStatusStyle('#2ECC71')).toEqual({
      color: '#2ECC71',
      borderColor: '#2ECC7166',
      backgroundColor: '#2ECC711f',
    });
  });
  it('fonce le fond quand sélectionné', () => {
    expect(reviewStatusStyle('#2ECC71', true).backgroundColor).toBe('#2ECC712e');
  });
});

describe('pickPreselectedStatus', () => {
  const statuses = [
    { id: 1, isDefault: false },
    { id: 2, isDefault: true },
    { id: 3, isDefault: false },
  ];
  it('priorise la décision courante', () => {
    expect(pickPreselectedStatus({ id: 3 }, statuses)).toBe(3);
  });
  it('retombe sur le statut par défaut du studio', () => {
    expect(pickPreselectedStatus(null, statuses)).toBe(2);
  });
  it('null sans décision ni défaut', () => {
    expect(pickPreselectedStatus(null, [{ id: 1, isDefault: false }])).toBeNull();
  });
});
