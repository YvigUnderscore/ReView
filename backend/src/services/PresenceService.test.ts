import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: { user: { update: vi.fn() } } }));

import { joinReview, leaveReview, getReviewViewers, type ReviewViewer } from './PresenceService';

const viewer = (id: number, name = `User ${id}`): ReviewViewer => ({
  id,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  avatarUrl: null,
});

describe('PresenceService — présence par review', () => {
  it('ajoute puis retire un spectateur', () => {
    expect(joinReview(1001, viewer(1)).map((v) => v.id)).toEqual([1]);
    expect(joinReview(1001, viewer(2)).map((v) => v.id)).toEqual([1, 2]);
    expect(leaveReview(1001, 1).map((v) => v.id)).toEqual([2]);
    expect(leaveReview(1001, 2)).toEqual([]);
    expect(getReviewViewers(1001)).toEqual([]);
  });

  it('compte les onglets multiples : ne retire qu’au dernier leave', () => {
    joinReview(1002, viewer(5));
    joinReview(1002, viewer(5));
    expect(leaveReview(1002, 5).map((v) => v.id)).toEqual([5]);
    expect(leaveReview(1002, 5)).toEqual([]);
  });

  it('isole les reviews entre elles et ignore un leave inconnu', () => {
    joinReview(2001, viewer(1));
    joinReview(2002, viewer(2));
    expect(getReviewViewers(2001).map((v) => v.id)).toEqual([1]);
    expect(getReviewViewers(2002).map((v) => v.id)).toEqual([2]);
    expect(leaveReview(2001, 99).map((v) => v.id)).toEqual([1]);
    leaveReview(2001, 1);
    leaveReview(2002, 2);
  });

  it('rafraîchit l’identité au re-join (avatar présigné le plus récent)', () => {
    joinReview(3001, viewer(7, 'Ancien Nom'));
    const updated = { ...viewer(7, 'Nouveau Nom'), avatarUrl: 'https://exemple/avatar.png' };
    const list = joinReview(3001, updated);
    expect(list).toEqual([updated]);
    leaveReview(3001, 7);
    leaveReview(3001, 7);
  });
});
