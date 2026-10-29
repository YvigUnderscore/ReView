// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { checkNaming, isCatastrophicPattern } from './projectSettings';

/**
 * The naming convention is a regex typed by a project manager, executed on every uploaded file name. Node has no maximum
 * delay on a regex: an explosive pattern freezes the event loop, hence the whole API.
 */
describe('isCatastrophicPattern', () => {
  it('spots nested quantifiers', () => {
    for (const p of ['(a+)+$', '(a*)*$', '^(a+)*$', '(\\d+)+x', '(ab{1,9})+'])
      expect(isCatastrophicPattern(p), p).toBe(true);
  });

  // A regex cannot count parentheses: the earlier versions of this check required a group body without parentheses and therefore
  // let nesting through. `((a+))+` remains exponential — 30 characters are enough to block the loop for ~13 s.
  it('spots nested groups', () => {
    for (const p of ['((a+))+$', '((a|b))+', '(a(b+))*$', '((x|y|xy))+', '(((a+)))+'])
      expect(isCatastrophicPattern(p), p).toBe(true);
  });

  it('is not fooled by character classes or escapes', () => {
    // `[+*|]` and `\(` are literal: nothing ambiguous here.
    for (const p of ['^([+*|])$', '^(\\(a\\))+$', '^([a-z])+$'])
      expect(isCatastrophicPattern(p), p).toBe(false);
  });

  it('spots quantified alternations, whatever the number of branches', () => {
    for (const p of ['(a|a)*$', '(a|b|ab)*$', '(x|y|z|xy)+', '^(\\d|\\d\\d|\\d\\d\\d)*$'])
      expect(isCatastrophicPattern(p), p).toBe(true);
  });

  it('lets realistic naming conventions through', () => {
    for (const p of [
      '^[A-Z]{3}_\\d{4}_v\\d{3}\\.(exr|mov)$',
      '^shot_\\d+_.+\\.mov$',
      '.*\\.usd[acz]?$',
      '^(SEQ|SHOT)_[0-9]+$',
    ])
      expect(isCatastrophicPattern(p), p).toBe(false);
  });
});

describe('checkNaming', () => {
  it('never executes an explosive pattern: the convention is disabled', () => {
    const evil = { pattern: '(a+)+$', mode: 'reject' as const };
    const start = Date.now();
    const r = checkNaming('a'.repeat(40) + '!', evil);
    expect(Date.now() - start).toBeLessThan(1000);
    // Same fallback as an invalid regex: the convention is not a security lock.
    expect(r).toEqual({ pass: true, mode: 'off' });
  });

  it('applies a legitimate convention', () => {
    const rule = { pattern: '^[A-Z]{3}_\\d{4}\\.exr$', mode: 'reject' as const };
    expect(checkNaming('ABC_0012.exr', rule)).toEqual({ pass: true, mode: 'reject' });
    expect(checkNaming('nope.exr', rule)).toEqual({ pass: false, mode: 'reject' });
  });

  it('falls back to off for an invalid regex or an off mode', () => {
    expect(checkNaming('x', { pattern: '([', mode: 'reject' })).toEqual({ pass: true, mode: 'off' });
    expect(checkNaming('x', { pattern: '^x$', mode: 'off' })).toEqual({ pass: true, mode: 'off' });
  });
});
