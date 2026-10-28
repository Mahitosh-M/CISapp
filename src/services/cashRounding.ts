import { collection, doc, serverTimestamp, type Transaction } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { roundCashBalance } from '../utils/wholeRupees';

/** Call only after all transaction reads. The audit and balance must commit together. */
export function cashBalanceFields(transaction: Transaction, shopId: string, before: number, delta: number, operationId: string) {
  const result = roundCashBalance(before, delta);
  let roundingAuditId: string | null = null;
  if (result.adjustment !== 0) {
    if (!auth.currentUser) throw new Error('Sign in before rounding a cash balance');
    const audit = doc(collection(db, 'cashAdjustments'));
    roundingAuditId = audit.id;
    transaction.set(audit, {
      shopId,
      amount: Math.abs(result.adjustment),
      direction: result.adjustment > 0 ? 'add' : 'deduct',
      reason: `Whole-rupee rounding: ${result.rawBalance} -> ${result.availableBalance}; operation ${operationId.slice(0, 50)}`,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
    });
  }
  return { availableBalance: result.availableBalance, roundingDelta: result.adjustment, roundingAuditId };
}
