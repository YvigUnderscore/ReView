import { describe, it, expect } from 'vitest';
import { parseSizeToBytes, bytesToUnit } from './adminShared';

describe('adminShared — tailles Mo/Go (Phase 21)', () => {
  it('parseSizeToBytes convertit Go et Mo', () => {
    expect(parseSizeToBytes('5', 'Go')).toBe(5e9);
    expect(parseSizeToBytes('500', 'Mo')).toBe(5e8);
  });

  it('parseSizeToBytes accepte la virgule décimale', () => {
    expect(parseSizeToBytes('5,5', 'Go')).toBe(5_500_000_000);
    expect(parseSizeToBytes('1.25', 'Go')).toBe(1_250_000_000);
  });

  it('parseSizeToBytes rejette les valeurs invalides', () => {
    expect(parseSizeToBytes('abc', 'Go')).toBeNull();
    expect(parseSizeToBytes('-1', 'Go')).toBeNull();
    expect(parseSizeToBytes('', 'Mo')).toBeNull();
  });

  it('bytesToUnit choisit Go dès 1 Go, sinon Mo', () => {
    expect(bytesToUnit(5e9)).toEqual({ value: '5', unit: 'Go' });
    expect(bytesToUnit(5e8)).toEqual({ value: '500', unit: 'Mo' });
    expect(bytesToUnit(1_250_000_000)).toEqual({ value: '1.25', unit: 'Go' });
  });

  it('round-trip exact pour une valeur ronde', () => {
    const { value, unit } = bytesToUnit(5e9);
    expect(parseSizeToBytes(value, unit)).toBe(5e9);
  });
});
