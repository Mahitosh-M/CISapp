import { describe, expect, it } from 'vitest';
import { requireWholeRupees, roundCashBalance } from './wholeRupees';
describe('whole-rupee accounting', () => {
  it('rounds the stored balance with an exact, separately auditable difference', () => {
    expect(roundCashBalance(.2)).toEqual({availableBalance:0,adjustment:-.2,rawBalance:.2});
    expect(roundCashBalance(1000, -983.9)).toEqual({availableBalance:16,adjustment:-.1,rawBalance:16.1});
    expect(roundCashBalance(10.5)).toEqual({availableBalance:11,adjustment:.5,rawBalance:10.5});
    expect(roundCashBalance(-10.5)).toEqual({availableBalance:-11,adjustment:-.5,rawBalance:-10.5});
  });
  it('rejects fractional, negative and unsafe new transaction amounts', () => {
    for (const value of [.2,100.01,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) expect(()=>requireWholeRupees(value)).toThrow();
    expect(requireWholeRupees(100)).toBe(100);
  });
});
